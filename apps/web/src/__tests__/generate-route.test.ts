import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AgentModule from '@/server/agent';
import { POST } from '@/app/api/generate/route';
const mocks = vi.hoisted(() => ({
  getVerifiedSession: vi.fn(),
  checkRateLimit: vi.fn(),
  createAgentStream: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getVerifiedSession: mocks.getVerifiedSession,
}));

vi.mock('@/server/rate-limit', () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock('@/server/agent', async (importOriginal) => {
  const actual = await importOriginal<typeof AgentModule>();
  return {
    ...actual,
    createAgentStream: mocks.createAgentStream,
  };
});

function postGenerate(body: unknown, headers: Record<string, string> = {}) {
  const request = new NextRequest('http://localhost/api/generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return POST(request);
}

describe('POST /api/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getVerifiedSession.mockResolvedValue({
      user: { id: 'user-1', email: 'test@example.com' },
    });
    mocks.checkRateLimit.mockResolvedValue({ allowed: true });
  });

  it('rejects unauthenticated requests with 401', async () => {
    mocks.getVerifiedSession.mockResolvedValue(null);
    const response = await postGenerate({
      projectId: 'p1',
      message: 'build app',
      modelProvider: 'anthropic',
      modelName: 'claude-3-5-sonnet',
    });
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data).toEqual({ error: 'Unauthorized' });
  });

  it('rejects invalid JSON body with 400', async () => {
    const request = new NextRequest('http://localhost/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'invalid-json{{{',
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toEqual({ error: 'Invalid JSON body' });
  });

  it('rejects invalid payload with 400', async () => {
    const response = await postGenerate({
      projectId: '',
      message: 'hello',
    });
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data).toEqual({ error: 'Missing generation input' });
  });

  it('enforces rate limits with 429', async () => {
    mocks.checkRateLimit.mockResolvedValue({
      allowed: false,
      resetAt: Date.now() + 15_000,
    });
    const response = await postGenerate({
      projectId: 'p1',
      message: 'hello',
      modelProvider: 'anthropic',
      modelName: 'claude-3-5-sonnet',
    });
    expect(response.status).toBe(429);
    const data = await response.json();
    expect(data.error).toContain('Rate limit exceeded');
  });

  it('relays non-ok error status from agent runner', async () => {
    mocks.createAgentStream.mockResolvedValue({
      ok: false,
      status: 404,
      body: { error: 'Project not found' },
    });

    const response = await postGenerate({
      projectId: 'p1',
      message: 'hello',
      modelProvider: 'anthropic',
      modelName: 'claude-3-5-sonnet',
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data).toEqual({ error: 'Project not found' });
  });

  it('pipes the SSE generator to the response stream on success', async () => {
    async function* mockGenerator(): AsyncGenerator<Uint8Array> {
      yield new TextEncoder().encode('event: phase\ndata: {"phase":"planning"}\n\n');
      yield new TextEncoder().encode('event: ready\ndata: {"versionNumber":1}\n\n');
    }

    mocks.createAgentStream.mockResolvedValue({
      ok: true,
      generator: mockGenerator(),
    });

    const response = await postGenerate(
      {
        projectId: 'p1',
        message: 'build app',
        modelProvider: 'anthropic',
        modelName: 'claude-3-5-sonnet',
      },
      { 'X-Sovereign-Runtime': '1' },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');

    expect(mocks.createAgentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        user: { id: 'user-1', email: 'test@example.com' },
        runtimeEnabled: true,
        body: expect.objectContaining({
          projectId: 'p1',
          message: 'build app',
          modelProvider: 'anthropic',
          modelName: 'claude-3-5-sonnet',
        }),
      }),
    );

    // Consume the streamed response
    const text = await response.text();
    expect(text).toContain('event: phase\ndata: {"phase":"planning"}\n\n');
    expect(text).toContain('event: ready\ndata: {"versionNumber":1}\n\n');
  });

  it('unwinds the agent generator when the client disconnects', async () => {
    let cleanedUp = false;
    async function* shortGenerator(): AsyncGenerator<Uint8Array> {
      try {
        yield new TextEncoder().encode('event: phase\ndata: {"phase":"planning"}\n\n');
        yield new TextEncoder().encode('event: ready\ndata: {"versionNumber":1}\n\n');
      } finally {
        // The runner aborts in-flight provider calls and releases the
        // generation lease in this block: a disconnect that never reaches it
        // leaves the project stuck behind a live lease.
        cleanedUp = true;
      }
    }

    mocks.createAgentStream.mockResolvedValue({
      ok: true,
      generator: shortGenerator(),
    });

    const response = await postGenerate({
      projectId: 'p1',
      message: 'build app',
      modelProvider: 'anthropic',
      modelName: 'claude-3-5-sonnet',
    });

    const reader = response.body!.getReader();
    await reader.read();
    // Cancelling must resolve only once the generator has been unwound, so the
    // lease release is not racing the next request for the same project.
    await reader.cancel('client disconnected');

    expect(cleanedUp).toBe(true);
  });
});
