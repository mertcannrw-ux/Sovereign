// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the mock factory can close over it: `vi.mock` is lifted above the
// imports, and the TRUSTED_PROXY-off case below needs to flip the flag. The
// real `env` object is frozen by createEnv, so it cannot be mutated directly.
const envMock = vi.hoisted(() => ({
  UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
  UPSTASH_REDIS_REST_TOKEN: 'token',
  NEXTAUTH_SECRET: 'a'.repeat(32),
  TRUSTED_PROXY: true,
}));

vi.mock('@/env', () => ({ env: envMock }));

import { checkRateLimit, RATE_LIMITS, trustedClientIp } from './rate-limit';

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

  it('falls back to in-memory limits (not a hard deny) in production when Upstash returns a malformed payload', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ cmd: 'not-a-pipeline-result' }],
    }) as unknown as typeof fetch;

    // An Upstash outage must never brick sign-in/registration platform-wide:
    // the per-instance fallback limiter still applies the configured window.
    const limit = RATE_LIMITS.signIn.limit;
    for (let attempt = 1; attempt <= limit; attempt += 1) {
      const result = await checkRateLimit('signIn', 'user-2');
      expect(result.allowed).toBe(true);
    }
    const overLimit = await checkRateLimit('signIn', 'user-2');
    expect(overLimit.allowed).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe('trustedClientIp', () => {
  it('reads a plain header object, the shape next-auth passes to authorize()', () => {
    // Regression: `authorize(credentials, req)` receives
    // `Object.fromEntries(await headers())`, which has no `.get` method. A
    // Headers-only implementation silently returned null here, collapsing the
    // sign-in bucket onto the bare email and letting an attacker lock out any
    // address with five attempts.
    expect(trustedClientIp({ 'x-forwarded-for': '203.0.113.7' })).toBe('203.0.113.7');
  });

  it('reads a Headers instance, the shape route handlers pass', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7' });
    expect(trustedClientIp(headers)).toBe('203.0.113.7');
  });

  it('takes the right-most X-Forwarded-For entry, ignoring client-supplied ones', () => {
    // A proxy appends the real caller; everything to its left is attacker text.
    expect(trustedClientIp({ 'x-forwarded-for': '198.51.100.1, 6.6.6.6, 203.0.113.7' })).toBe(
      '203.0.113.7',
    );
  });

  it('falls back to X-Real-IP only when X-Forwarded-For is absent', () => {
    expect(trustedClientIp({ 'x-real-ip': '203.0.113.9' })).toBe('203.0.113.9');
    // Both headers carry a valid address: XFF wins, so a forged X-Real-IP is
    // ignored.
    expect(trustedClientIp({ 'x-forwarded-for': '203.0.113.7', 'x-real-ip': '6.6.6.6' })).toBe(
      '203.0.113.7',
    );
  });

  it('fails closed when X-Forwarded-For is present but unusable', () => {
    // Regression: the X-Real-IP branch used to run whenever the right-most XFF
    // entry failed to parse, so `X-Forwarded-For: junk` plus a fresh random
    // X-Real-IP per request minted a new rate-limit bucket every time and the
    // 5-per-15-min sign-in limit on a known email disappeared. Null keeps each
    // caller on its documented fallback instead.
    expect(trustedClientIp({ 'x-forwarded-for': 'junk', 'x-real-ip': '203.0.113.9' })).toBeNull();
    expect(trustedClientIp({ 'x-forwarded-for': ',,,', 'x-real-ip': '203.0.113.9' })).toBeNull();
    expect(trustedClientIp({ 'x-forwarded-for': 'junk' })).toBeNull();
  });

  it('matches plain-object header names case-insensitively', () => {
    expect(trustedClientIp({ 'X-Forwarded-For': '203.0.113.7' })).toBe('203.0.113.7');
  });

  it('rejects values that are not IP literals', () => {
    expect(trustedClientIp({ 'x-forwarded-for': 'not-an-ip' })).toBeNull();
    expect(trustedClientIp({ 'x-forwarded-for': '1.2.3.4.5' })).toBeNull();
    expect(trustedClientIp(undefined)).toBeNull();
  });

  it('returns null when TRUSTED_PROXY is off, so callers key per-email', () => {
    envMock.TRUSTED_PROXY = false;
    try {
      expect(trustedClientIp({ 'x-forwarded-for': '203.0.113.7' })).toBeNull();
    } finally {
      envMock.TRUSTED_PROXY = true;
    }
  });
});
