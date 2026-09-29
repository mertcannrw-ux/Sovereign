import { describe, expect, it, vi } from 'vitest';
import {
  RUNTIME_HEARTBEAT_MS,
  RUNTIME_TRACE_PENDING,
  coerceRuntimeResult,
  putRuntimeResult,
  takeRuntimeResult,
  waitForRuntimeResult,
  type RuntimeTraceRow,
} from '@/lib/runtime-bridge';

const COMPLETE_RESULT = {
  status: 'complete' as const,
  output: 'ok',
  exitCode: 0,
  durationMs: 1_200,
};

/** `loadTrace` that answers from a queue, one response per poll. */
function traceQueue(...rows: Array<RuntimeTraceRow | null>) {
  const calls: string[] = [];
  return {
    calls,
    loadTrace: vi.fn(async (requestId: string) => {
      calls.push(requestId);
      return rows.length > 1 ? rows.shift()! : (rows[0] ?? null);
    }),
  };
}

describe('runtime result hand-off', () => {
  it('consumes a result exactly once', () => {
    putRuntimeResult('req-1', COMPLETE_RESULT);
    expect(takeRuntimeResult('req-1')).toEqual(COMPLETE_RESULT);
    expect(takeRuntimeResult('req-1')).toBeNull();
  });

  it('drops the oldest pending results beyond the in-process cap', () => {
    for (let index = 0; index < 40; index += 1) {
      putRuntimeResult(`req-${index}`, COMPLETE_RESULT);
    }
    expect(takeRuntimeResult('req-0')).toBeNull();
    expect(takeRuntimeResult('req-39')).toEqual(COMPLETE_RESULT);
  });
});

describe('coerceRuntimeResult', () => {
  it('accepts a well-formed client payload', () => {
    expect(
      coerceRuntimeResult({
        status: 'failed',
        output: 'boom',
        exitCode: null,
        durationMs: 12.4,
        error: 'spawn failed',
        consoleErrors: ['[preview CONSOLE_ERROR] x'],
      }),
    ).toEqual({
      status: 'failed',
      output: 'boom',
      exitCode: null,
      durationMs: 12,
      error: 'spawn failed',
      consoleErrors: ['[preview CONSOLE_ERROR] x'],
    });
  });

  it('rejects unknown shapes and statuses', () => {
    expect(coerceRuntimeResult(null)).toBeNull();
    expect(coerceRuntimeResult('ok')).toBeNull();
    expect(coerceRuntimeResult({ status: 'done' })).toBeNull();
    expect(coerceRuntimeResult({ output: 'x' })).toBeNull();
  });

  it('caps output and error size', () => {
    const result = coerceRuntimeResult({
      status: 'complete',
      output: 'x'.repeat(100_000),
      exitCode: 1,
      durationMs: 0,
      error: 'e'.repeat(5_000),
    });
    expect(result!.output.length).toBeLessThanOrEqual(8_000);
    expect(result!.error!.length).toBe(2_000);
  });
});

describe('waitForRuntimeResult', () => {
  it('resolves from the in-process fast path without touching the trace', async () => {
    putRuntimeResult('req-fast', COMPLETE_RESULT);
    const { loadTrace, calls } = traceQueue({ status: RUNTIME_TRACE_PENDING, result: null });

    const outcome = await waitForRuntimeResult({
      requestId: 'req-fast',
      timeoutMs: 1_000,
      loadTrace,
      sleep: async () => {},
    });

    expect(outcome).toEqual({ kind: 'result', result: COMPLETE_RESULT });
    expect(calls).toHaveLength(0);
  });

  it('resolves from a completed trace row written by another instance', async () => {
    const { loadTrace } = traceQueue({
      status: 'complete',
      result: { status: 'complete', output: 'built', exitCode: 0, durationMs: 900 },
    });

    const outcome = await waitForRuntimeResult({
      requestId: 'req-trace',
      timeoutMs: 1_000,
      loadTrace,
      sleep: async () => {},
    });

    expect(outcome).toEqual({
      kind: 'result',
      result: {
        status: 'complete',
        output: 'built',
        exitCode: 0,
        durationMs: 900,
        consoleErrors: [],
      },
    });
  });

  it('keeps polling while the trace is pending, then resolves', async () => {
    const { loadTrace, calls } = traceQueue(
      { status: RUNTIME_TRACE_PENDING, result: null },
      { status: 'complete', result: COMPLETE_RESULT },
    );

    const outcome = await waitForRuntimeResult({
      requestId: 'req-pending',
      timeoutMs: 5_000,
      loadTrace,
      sleep: async () => {},
    });

    expect(outcome).toEqual({ kind: 'result', result: { ...COMPLETE_RESULT, consoleErrors: [] } });
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('ignores a terminal row with an unusable result payload', async () => {
    const { loadTrace } = traceQueue({ status: 'complete', result: { junk: true } });

    const outcome = await waitForRuntimeResult({
      requestId: 'req-bad-row',
      timeoutMs: 0,
      loadTrace,
      sleep: async () => {},
    });

    expect(outcome).toEqual({ kind: 'timeout' });
  });

  it('times out when nothing ever arrives', async () => {
    const { loadTrace } = traceQueue(null);

    const outcome = await waitForRuntimeResult({
      requestId: 'req-timeout',
      timeoutMs: 0,
      loadTrace,
      sleep: async () => {},
    });

    expect(outcome).toEqual({ kind: 'timeout' });
  });

  it('stops on an aborted run instead of waiting out the budget', async () => {
    const controller = new AbortController();
    controller.abort();
    const { loadTrace, calls } = traceQueue(null);

    const outcome = await waitForRuntimeResult({
      requestId: 'req-aborted',
      timeoutMs: 60_000,
      signal: controller.signal,
      loadTrace,
      sleep: async () => {},
    });

    expect(outcome).toEqual({ kind: 'aborted' });
    expect(calls).toHaveLength(0);
  });

  it('heartbeats while waiting and stops once a result arrives', async () => {
    // `sleep` must advance the clock: `Date.now() >= nextHeartbeatAt` decides
    // the beat, so an instant sleep would never fire one in real time either.
    const { loadTrace } = traceQueue(
      { status: RUNTIME_TRACE_PENDING, result: null },
      { status: RUNTIME_TRACE_PENDING, result: null },
      { status: 'complete', result: COMPLETE_RESULT },
    );
    const heartbeats: string[] = [];
    const now = { value: Date.now() };
    const wait = waitForRuntimeResult({
      requestId: 'req-heartbeat',
      timeoutMs: 45_000,
      loadTrace,
      onHeartbeat: () => heartbeats.push('beat'),
      pollIntervalMs: RUNTIME_HEARTBEAT_MS,
      sleep: async (ms: number) => {
        now.value += ms;
      },
    });
    // Drive the loop: stub Date.now before the first await resolves.
    const realNow = Date.now;
    let outcome: Awaited<typeof wait> | undefined;
    try {
      Date.now = () => now.value;
      outcome = await wait;
    } finally {
      Date.now = realNow;
    }

    expect(outcome).toEqual({ kind: 'result', result: { ...COMPLETE_RESULT, consoleErrors: [] } });
    // Poll 1 (t+0): pending, no beat. Poll 2 (t+15s): pending, beat. Poll 3
    // (t+30s): complete — result returned, no third beat.
    expect(heartbeats.length).toBe(1);
  });

  it('never heartbeats when no callback is provided', async () => {
    const { loadTrace } = traceQueue(
      { status: RUNTIME_TRACE_PENDING, result: null },
      { status: 'complete', result: COMPLETE_RESULT },
    );

    await expect(
      waitForRuntimeResult({
        requestId: 'req-no-callback',
        timeoutMs: 60_000,
        loadTrace,
        pollIntervalMs: RUNTIME_HEARTBEAT_MS,
        sleep: async () => {},
      }),
    ).resolves.toEqual({ kind: 'result', result: { ...COMPLETE_RESULT, consoleErrors: [] } });
  });
});
