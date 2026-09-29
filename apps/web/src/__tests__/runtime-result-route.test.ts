import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/generate/runtime/[requestId]/route';
import {
  RUNTIME_TRACE_PENDING,
  takeRuntimeResult,
  waitForRuntimeResult,
} from '@/lib/runtime-bridge';

/**
 * The runtime POST is the other half of the bridge: it authorizes the caller,
 * persists the result for cross-instance waiters, and hands the payload to the
 * in-process waiter. Nothing else connects the blocked generation stream to the
 * browser that executed the command.
 */
const mocks = vi.hoisted(() => ({
  getVerifiedSession: vi.fn(),
  requireProjectRole: vi.fn(),
  traceFindFirst: vi.fn(),
  traceUpdate: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getVerifiedSession: mocks.getVerifiedSession }));
vi.mock('@/server/authz', () => ({ requireProjectRole: mocks.requireProjectRole }));
vi.mock('@/lib/db', () => ({
  getDb: () => ({
    generationToolTrace: {
      findFirst: mocks.traceFindFirst,
      update: mocks.traceUpdate,
    },
  }),
}));

const PROJECT_ID = 'project-1';
const USER_ID = 'user-1';
const REQUEST_ID = 'req-1';

const ROW = {
  id: 'trace-1',
  status: RUNTIME_TRACE_PENDING,
  run: { userId: USER_ID, projectId: PROJECT_ID },
};

function postRuntimePayload(payload: unknown, requestId: string = REQUEST_ID) {
  const request = new NextRequest(`http://localhost/api/generate/runtime/${requestId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return POST(request, { params: Promise.resolve({ requestId }) });
}

describe('POST /api/generate/runtime/[requestId]', () => {
  beforeEach(() => {
    mocks.getVerifiedSession.mockReset().mockResolvedValue({ user: { id: USER_ID } });
    mocks.requireProjectRole.mockReset().mockResolvedValue(undefined);
    mocks.traceFindFirst.mockReset().mockResolvedValue(ROW);
    mocks.traceUpdate.mockReset().mockResolvedValue({});
    takeRuntimeResult(REQUEST_ID);
  });

  it('persists the result and primes the in-process waiter', async () => {
    const response = await postRuntimePayload({
      status: 'complete',
      output: 'src/App.tsx(3,5): error TS2304',
      exitCode: 2,
      durationMs: 8_100,
      consoleErrors: ['[preview PREVIEW_CONSOLE_ERROR] boom'],
    });

    expect(response.status).toBe(200);
    expect(mocks.traceUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.traceUpdate.mock.calls[0]![0]).toMatchObject({
      where: { id: 'trace-1' },
      data: { status: 'complete', durationMs: 8_100 },
    });
    expect(takeRuntimeResult(REQUEST_ID)).toMatchObject({
      status: 'complete',
      exitCode: 2,
      consoleErrors: ['[preview PREVIEW_CONSOLE_ERROR] boom'],
    });
  });

  it('resolves the blocked generation stream with the accepted result', async () => {
    // A permanently-pending trace row: the waiter cannot learn the result from
    // the database, so this exercises the route → waiter hand-off as the
    // generation stream actually depends on it.
    const pending = waitForRuntimeResult({
      requestId: REQUEST_ID,
      timeoutMs: 5_000,
      loadTrace: async () => ({ status: RUNTIME_TRACE_PENDING, result: null }),
      pollIntervalMs: 10,
    });

    const response = await postRuntimePayload({
      status: 'complete',
      output: 'built',
      exitCode: 0,
      durationMs: 2_000,
    });

    expect(response.status).toBe(200);
    await expect(pending).resolves.toMatchObject({
      kind: 'result',
      result: { status: 'complete', output: 'built', exitCode: 0 },
    });
  });

  it('rejects a run owned by another user without storing anything', async () => {
    mocks.getVerifiedSession.mockResolvedValue({ user: { id: 'intruder' } });

    const response = await postRuntimePayload({
      status: 'complete',
      output: 'x',
      exitCode: 0,
      durationMs: 1,
    });

    expect(response.status).toBe(404);
    expect(mocks.traceUpdate).not.toHaveBeenCalled();
    expect(takeRuntimeResult(REQUEST_ID)).toBeNull();
  });

  it('rejects a caller who cannot edit the project', async () => {
    mocks.requireProjectRole.mockRejectedValue(new Error('forbidden'));

    const response = await postRuntimePayload({
      status: 'complete',
      output: 'x',
      exitCode: 0,
      durationMs: 1,
    });

    expect(response.status).toBe(404);
    expect(mocks.traceUpdate).not.toHaveBeenCalled();
  });

  it('rejects malformed payloads and unknown request ids', async () => {
    const badPayload = await postRuntimePayload({ status: 'done' });
    expect(badPayload.status).toBe(400);
    expect(mocks.traceUpdate).not.toHaveBeenCalled();

    mocks.traceFindFirst.mockResolvedValue(null);
    const unknownId = await postRuntimePayload({
      status: 'complete',
      output: 'x',
      exitCode: 0,
      durationMs: 1,
    });
    expect(unknownId.status).toBe(404);
  });

  it('acknowledges a duplicate delivery for an already-answered request', async () => {
    mocks.traceFindFirst.mockResolvedValue({ ...ROW, status: 'complete' });

    const response = await postRuntimePayload({
      status: 'complete',
      output: 'x',
      exitCode: 0,
      durationMs: 1,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, duplicate: true });
    expect(mocks.traceUpdate).not.toHaveBeenCalled();
  });

  it('requires a session', async () => {
    mocks.getVerifiedSession.mockResolvedValue(null);

    const response = await postRuntimePayload({
      status: 'complete',
      output: 'x',
      exitCode: 0,
      durationMs: 1,
    });

    expect(response.status).toBe(401);
  });
});
