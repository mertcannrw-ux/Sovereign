import {
  MAX_RUNTIME_ERROR_CHARS,
  RUNTIME_OUTPUT_MAX_CHARS,
  sanitizePreviewErrors,
  truncateRuntimeOutput,
  type RuntimeCommandResult,
} from '@/lib/runtime-commands';

/**
 * Server-side hand-off between the generation stream (the waiter) and
 * `POST /api/generate/runtime/[requestId]` (the client delivering a run
 * result). Server only — the client talks to the POST route over HTTP.
 *
 * The in-process map is the fast path: in a single-instance deployment the POST
 * resolves the waiter without touching the database. The `GenerationToolTrace`
 * row is the shared state that keeps the loop correct when the POST lands on a
 * different instance (serverless, multiple replicas), so the waiter also polls
 * it and either source can produce the result.
 */

/** Trace status while the client has not answered yet. */
export const RUNTIME_TRACE_PENDING = 'pending';
/** Terminal trace status when the client never answered within the budget. */
export const RUNTIME_TRACE_TIMEOUT = 'timeout';
/** Terminal trace status when the run was stopped by the user. */
export const RUNTIME_TRACE_ABORTED = 'aborted';

export const RUNTIME_POLL_INTERVAL_MS = 250;

/** Extra time over the command budget before the waiter gives up. */
export const RUNTIME_RESULT_GRACE_MS = 15_000;

/** How often the waiter fires `onHeartbeat` while waiting. */
export const RUNTIME_HEARTBEAT_MS = 15_000;

/** Only the fields the waiter reads from a trace row. */
export interface RuntimeTraceRow {
  status: string;
  result: unknown;
}

export type RuntimeWaitOutcome =
  { kind: 'result'; result: RuntimeCommandResult } | { kind: 'timeout' } | { kind: 'aborted' };

const inProcessResults = new Map<string, RuntimeCommandResult>();
/** Bounds orphaned entries from requests the waiter never read (POST errors). */
const IN_PROCESS_LIMIT = 32;

/** Store a result for a waiter running in this process. */
export function putRuntimeResult(requestId: string, result: RuntimeCommandResult): void {
  inProcessResults.set(requestId, result);
  while (inProcessResults.size > IN_PROCESS_LIMIT) {
    const oldest = inProcessResults.keys().next().value;
    if (oldest === undefined) break;
    inProcessResults.delete(oldest);
  }
}

/** Consume a result stored by this process, if any. */
export function takeRuntimeResult(requestId: string): RuntimeCommandResult | null {
  const result = inProcessResults.get(requestId);
  if (!result) return null;
  inProcessResults.delete(requestId);
  return result;
}

/**
 * Validate a client-supplied run result before it is stored or fed to the
 * model. Unknown shapes are rejected rather than trusted: this payload crosses
 * the network boundary (and the JSON column round-trip).
 */
export function coerceRuntimeResult(value: unknown): RuntimeCommandResult | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.status !== 'complete' && record.status !== 'failed') return null;
  const output =
    typeof record.output === 'string'
      ? truncateRuntimeOutput(record.output.slice(0, RUNTIME_OUTPUT_MAX_CHARS * 4))
      : '';
  const durationMs =
    typeof record.durationMs === 'number' &&
    Number.isFinite(record.durationMs) &&
    record.durationMs >= 0
      ? Math.round(record.durationMs)
      : 0;
  return {
    status: record.status,
    output,
    exitCode:
      typeof record.exitCode === 'number' && Number.isFinite(record.exitCode)
        ? record.exitCode
        : null,
    durationMs,
    ...(typeof record.error === 'string' && record.error.trim()
      ? { error: record.error.trim().slice(0, MAX_RUNTIME_ERROR_CHARS) }
      : {}),
    consoleErrors: sanitizePreviewErrors(record.consoleErrors),
  };
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export interface WaitForRuntimeResultOptions {
  requestId: string;
  /** Overall budget: the command's own timeout plus the delivery grace. */
  timeoutMs: number;
  signal?: AbortSignal;
  /** Reads the persisted trace row — the only state shared across instances. */
  loadTrace: (requestId: string) => Promise<RuntimeTraceRow | null>;
  /**
   * Fired every {@link RUNTIME_HEARTBEAT_MS} while waiting. The SSE stream
   * emits nothing while a `run` executes — up to 195s for `npm install` —
   * and idle-timeout-happy proxies kill a silent stream long before the
   * command finishes. The client cannot miss a `runtime-request` because of
   * this: it arrives before the wait starts, not on the heartbeat schedule.
   */
  pollIntervalMs?: number;
  onHeartbeat?: () => void;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Block until the client posts a result for `requestId`, the run is stopped, or
 * the budget runs out. Never throws: every failure mode is an outcome the
 * caller turns into a model-facing tool result.
 */
export async function waitForRuntimeResult(
  options: WaitForRuntimeResultOptions,
): Promise<RuntimeWaitOutcome> {
  const { requestId, signal } = options;
  const pollIntervalMs = options.pollIntervalMs ?? RUNTIME_POLL_INTERVAL_MS;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + options.timeoutMs;
  let nextHeartbeatAt = Date.now() + RUNTIME_HEARTBEAT_MS;

  for (;;) {
    const local = takeRuntimeResult(requestId);
    if (local) return { kind: 'result', result: local };
    if (signal?.aborted) return { kind: 'aborted' };
    if (Date.now() >= deadline) return { kind: 'timeout' };

    const row = await options.loadTrace(requestId).catch(() => null);
    if (row && row.status !== RUNTIME_TRACE_PENDING && row.result) {
      const result = coerceRuntimeResult(row.result);
      if (result) return { kind: 'result', result };
    }

    if (signal?.aborted) return { kind: 'aborted' };
    const remaining = deadline - Date.now();
    if (remaining <= 0) return { kind: 'timeout' };
    // Keep the SSE stream alive: 250ms of silence turns into a periodic
    // heartbeat event so idle-timeout-happy proxies don't cut the run.
    if (Date.now() >= nextHeartbeatAt) {
      nextHeartbeatAt = Date.now() + RUNTIME_HEARTBEAT_MS;
      options.onHeartbeat?.();
    }
    await sleep(Math.min(pollIntervalMs, remaining));
  }
}
