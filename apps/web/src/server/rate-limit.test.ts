// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/env', () => ({
  env: {
    UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
    UPSTASH_REDIS_REST_TOKEN: 'token',
    NEXTAUTH_SECRET: 'a'.repeat(32),
  },
}));

import { checkRateLimit } from './rate-limit';

describe('checkRateLimit Upstash pipeline', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('posts a 2-D array of Redis commands', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ result: 1 }, { result: 1 }, { result: 1 }, { result: 1 }],
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await checkRateLimit('apiKeyTest', 'user-1');
    expect(result.allowed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string) as unknown[];
    expect(Array.isArray(body[0])).toBe(true);
    expect((body[0] as string[])[0]).toBe('ZREMRANGEBYSCORE');
    expect((body[1] as string[])[0]).toBe('ZADD');
  });

  it('denies the request in production when Upstash returns a malformed payload', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ cmd: 'not-a-pipeline-result' }],
    }) as unknown as typeof fetch;

    const result = await checkRateLimit('signIn', 'user-2');
    expect(result.allowed).toBe(false);
    vi.unstubAllEnvs();
  });
});
