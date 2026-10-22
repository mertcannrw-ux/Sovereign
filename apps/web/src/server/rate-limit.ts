/**
 * Rate limiting with Upstash Redis sliding window.
 * Falls back to per-instance in-memory limits when Upstash is not configured
 * or unreachable, so an outage can never brick sign-in/registration.
 */

import { env } from '@/env';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

// ─── Types ────────────────────────────────────────────────

interface RateLimitConfig {
  /** Maximum requests per window */
  limit: number;
  /** Window duration in seconds */
  windowSeconds: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

// ─── In-memory fallback (dev/test only) ──────────────────

// Hard cap on tracked fallback buckets. Without Redis this Map IS the limiter
// state, and identifiers are attacker-chosen (e.g. a unique email per sign-up),
// so an unbounded Map would let a single client OOM the instance. 10k keys is
// far above the number of live keys the short pre-auth windows can legitimately
// hold, so the cap is only ever reached under abuse.
const MAX_TRACKED_BUCKETS = 10_000;

const devBuckets = new Map<string, { count: number; resetAt: number; limit: number }>();

function evictExpiredDevBuckets(now: number): void {
  for (const [key, bucket] of devBuckets) {
    if (now > bucket.resetAt) devBuckets.delete(key);
  }
}

/**
 * Drop least-recently-used buckets until the map is back under `maxSize`.
 * `devBuckets` is a Map, so iteration order is insertion order; every access
 * re-inserts its bucket (see touchDevBucket), which makes that order
 * least-recently-accessed-first.
 *
 * A full map must still admit a brand-new identifier. The previous rule kept
 * blocking buckets and failed closed once every slot was full; an attacker
 * could then fill the 10k slots with over-limit keys and lock every real user
 * out of sign-in, registration and password reset for as long as the Upstash
 * fallback lasted. Evicting the oldest entry instead (blocking or not) costs
 * only the attacker's own stale counters and keeps the degraded fallback
 * available. Rotation is already unavoidable in a per-instance fallback: each
 * instance has no shared state.
 */
function evictOldestDevBuckets(maxSize: number): void {
  for (const key of devBuckets.keys()) {
    if (devBuckets.size <= maxSize) break;
    devBuckets.delete(key);
  }
}

/** Re-insert so recency ordering survives `set` on an existing key. */
function touchDevBucket(
  key: string,
  bucket: { count: number; resetAt: number; limit: number },
): void {
  devBuckets.delete(key);
  devBuckets.set(key, bucket);
}

function devSlidingWindow(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  evictExpiredDevBuckets(now);
  const bucket = devBuckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    // Only a brand-new key can grow the map, so make room for it here. Expired
    // buckets are already gone (evictExpiredDevBuckets above); if the map is
    // still full, the oldest entries are dropped. Never reject a first-seen
    // identifier for capacity: that turns an attacker-filled map into a global
    // outage of the fallback limiter.
    if (devBuckets.size >= MAX_TRACKED_BUCKETS) evictOldestDevBuckets(MAX_TRACKED_BUCKETS - 1);
    const fresh = { count: 1, resetAt: now + windowMs, limit: config.limit };
    devBuckets.set(key, fresh);
    return { allowed: true, remaining: config.limit - 1, resetAt: fresh.resetAt };
  }

  bucket.count++;
  touchDevBucket(key, bucket);
  const allowed = bucket.count <= config.limit;
  return {
    allowed,
    remaining: Math.max(0, config.limit - bucket.count),
    resetAt: bucket.resetAt,
  };
}

// ─── Upstash sliding window ──────────────────────────────

// Emitted once per process: an Upstash outage - or a deployment that
// deliberately runs without Redis - must not lock every user out of
// sign-in/registration, so we fall back to the in-memory limiter (per-instance,
// still functional) instead of denying everything in production. Warning only
// once keeps the degraded state visible without flooding production logs on
// every request.
let warnedUpstashDown = false;

function onUpstashUnavailable(reason: string): void {
  if (process.env.NODE_ENV === 'production' && !warnedUpstashDown) {
    warnedUpstashDown = true;
    console.warn(
      `[rate-limit] Upstash unavailable (${reason}); falling back to per-instance in-memory limits.`,
    );
  }
}

async function upstashSlidingWindow(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const url = env.UPSTASH_REDIS_REST_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    onUpstashUnavailable('not configured');
    return devSlidingWindow(key, config);
  }

  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - config.windowSeconds;

  // Use Upstash REST API for sliding window
  const pipeline = [
    ['ZREMRANGEBYSCORE', key, '-inf', windowStart.toString()],
    ['ZADD', key, now.toString(), `${now}-${Math.random().toString(36).slice(2)}`],
    ['ZCARD', key],
    ['EXPIRE', key, config.windowSeconds.toString()],
  ];

  let response: Response;
  try {
    response = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(pipeline),
      // A Redis instance that accepts the connection but never answers must
      // degrade to the in-memory limiter instead of stalling every sign-in
      // until the platform request times out.
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    onUpstashUnavailable('network error or timeout');
    return devSlidingWindow(key, config);
  }

  if (!response.ok) {
    onUpstashUnavailable(`HTTP ${response.status}`);
    return devSlidingWindow(key, config);
  }

  let results: unknown;
  try {
    results = await response.json();
  } catch {
    onUpstashUnavailable('malformed response');
    return devSlidingWindow(key, config);
  }

  if (!Array.isArray(results) || results.length < 4) {
    onUpstashUnavailable('unexpected pipeline shape');
    return devSlidingWindow(key, config);
  }

  const card = results[2] as { result?: unknown; error?: unknown };
  if (card.error != null || typeof card.result !== 'number') {
    onUpstashUnavailable('ZADD/ZCARD error');
    return devSlidingWindow(key, config);
  }

  const count = card.result;
  return {
    allowed: count <= config.limit,
    remaining: Math.max(0, config.limit - count),
    resetAt: (now + config.windowSeconds) * 1000,
  };
}

// ─── Public API ───────────────────────────────────────────

export const RATE_LIMITS = {
  signIn: { limit: 5, windowSeconds: 60 * 15 }, // 5 per 15 min
  register: { limit: 3, windowSeconds: 60 * 60 }, // 3 per hour
  passwordReset: { limit: 3, windowSeconds: 60 * 60 }, // 3 per hour
  passwordResetSubmit: { limit: 20, windowSeconds: 60 * 15 }, // 20 per 15 min
  passwordChange: { limit: 5, windowSeconds: 60 * 15 }, // 5 per 15 min
  emailChange: { limit: 3, windowSeconds: 60 * 60 }, // 3 per hour
  emailConfirm: { limit: 20, windowSeconds: 60 * 15 }, // 20 per 15 min
  accountExport: { limit: 3, windowSeconds: 60 * 60 }, // 3 per hour
  prompt: { limit: 30, windowSeconds: 60 }, // 30 per minute
  build: { limit: 10, windowSeconds: 60 * 5 }, // 10 per 5 min
  deploy: { limit: 5, windowSeconds: 60 * 10 }, // 5 per 10 min
  apiKeyTest: { limit: 10, windowSeconds: 60 }, // 10 per minute
  dbQuery: { limit: 60, windowSeconds: 60 }, // 60 per minute
  agentRun: { limit: 20, windowSeconds: 60 * 5 }, // 20 per 5 min
  invite: { limit: 20, windowSeconds: 60 * 60 }, // 20 per hour
  billing: { limit: 5, windowSeconds: 60 * 5 }, // 5 per 5 min
} as const satisfies Record<string, RateLimitConfig>;

export type RateLimitKey = keyof typeof RATE_LIMITS;

// Emitted once per process so operators notice pre-auth buckets are keyed
// per-email (not per client IP) when no trusted proxy header is present.
let warnedTrustedProxy = false;

/** Lazily created per-process HMAC key used only when NEXTAUTH_SECRET is unset. */
let processFallbackKey: Buffer | undefined;

/**
 * `TRUSTED_PROXY` is a boolean after `env.ts` parsing, but `SKIP_ENV_VALIDATION`
 * (and a bare `process.env` read) hands over the raw string, where `"false"`
 * is truthy. Coerce here so the security decision never depends on which path
 * populated the value.
 */
function isTrustedProxy(): boolean {
  return String(env.TRUSTED_PROXY) === 'true';
}

export async function checkRateLimit(
  key: RateLimitKey,
  identifier: string,
): Promise<RateLimitResult> {
  if (process.env.NODE_ENV === 'production' && !isTrustedProxy() && !warnedTrustedProxy) {
    warnedTrustedProxy = true;
    console.warn(
      '[rate-limit] TRUSTED_PROXY is not set. Requests are seen as 127.0.0.1, so pre-auth ' +
        'limits (register/signIn) are keyed per email instead of per client IP. Set ' +
        'TRUSTED_PROXY=true behind your proxy so limits are enforced per client IP.',
    );
  }

  // Identifiers come from user input (an email, a token). Keep them bounded so
  // a single request cannot retain or transmit megabytes of key material.
  const bounded =
    identifier.length <= 128
      ? identifier
      : `sha256:${createHash('sha256').update(identifier).digest('hex')}`;

  const config = RATE_LIMITS[key];
  const redisKey = `rl:${key}:${bounded}`;
  return upstashSlidingWindow(redisKey, config);
}

/**
 * Hash an IP address for privacy-preserving rate limiting.
 * Keyed HMAC-SHA256 so clients cannot precompute the rate-limit key for a
 * forged IP header.
 */
export function hashIp(ip: string): string {
  const secret = env.NEXTAUTH_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('NEXTAUTH_SECRET must be set for IP hashing');
  }
  // Derive a dedicated key for IP hashing to avoid reusing NEXTAUTH_SECRET
  // directly (CWE-321). HKDF-like construction: extract then expand.
  //
  // Without a secret (local development, tests) fall back to a random key
  // generated once per process: it keeps buckets stable for the process while
  // remaining unguessable, where a hard-coded fallback would let any client
  // precompute its own rate-limit key.
  const fallbackKey = (processFallbackKey ??= randomBytes(32));
  const derivedKey = createHmac('sha256', secret || fallbackKey)
    .update('rate-limit-ip-hashing')
    .digest();
  return createHmac('sha256', derivedKey).update(ip).digest('hex').slice(0, 32);
}

/**
 * Header bag as it reaches a rate-limit call site: a `Headers` instance from a
 * route handler, or a plain object from next-auth's
 * `authorize(credentials, req)` - `RequestInternal.headers` is
 * `Record<string, any>` there, built from `Object.fromEntries(await headers())`,
 * so it has no `.get` method. The value type is pinned to what HTTP headers
 * actually are rather than `unknown`, so passing something that is not a header
 * bag (the whole `req`, say) is a compile error instead of a silent null.
 */
export type HeaderBag = Headers | Record<string, string | string[] | undefined> | undefined;

function readHeader(headers: HeaderBag, name: string): string | null {
  if (!headers) return null;
  // Duck-type rather than `instanceof Headers`: a cross-realm or polyfilled
  // Headers (Next's edge runtime, undici) is not this realm's constructor.
  const get = (headers as Partial<Headers>).get;
  if (typeof get === 'function') return get.call(headers as Headers, name);
  // Plain object. HTTP header names are case-insensitive and neither Next's
  // `headers()` nor Node's IncomingHttpHeaders guarantees the casing a caller
  // asks for, so match case-insensitively instead of assuming lowercase keys.
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && typeof value === 'string') return value;
  }
  return null;
}

/**
 * The caller's real IP for rate-limit keys, or null when it cannot be trusted.
 *
 * Only meaningful behind a reverse proxy (`TRUSTED_PROXY`): without one every
 * request appears to come from the app itself, so keying on IP would collapse
 * all users into a single bucket. Both consumers - tRPC's `createContext` and
 * the credentials `authorize` hook - MUST resolve the IP here so the two paths
 * cannot drift into different keying for the same request. A null return means
 * "no trustworthy IP", and each caller applies its own fallback.
 */
export function trustedClientIp(headers: HeaderBag): string | null {
  if (!isTrustedProxy()) return null;

  const forwarded = readHeader(headers, 'x-forwarded-for');
  if (forwarded) {
    const entries = forwarded
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    // Proxies APPEND the caller's address, so the right-most entry is the one
    // added by our trusted proxy. Earlier entries are client-supplied and
    // spoofable - never trust them for a rate-limit key.
    const last = entries[entries.length - 1];
    if (last && isIP(last)) return last;
    // XFF is present but carries no usable peer address, so the proxy is not
    // appending one. Fail closed instead of falling through to X-Real-IP: on a
    // pass-through proxy that header is pure client text, and honouring it
    // hands out a fresh rate-limit bucket per request - the very bypass the
    // X-Real-IP branch below exists to prevent. Null keeps each caller on its
    // documented fallback (per-email keying in `authorize`, 127.0.0.1 in tRPC).
    return null;
  }

  // Reached only when XFF is ABSENT: a proxy/CDN that appends to XFF but does
  // not set X-Real-IP (a common default) would otherwise let any client mint a
  // fresh rate-limit bucket by sending an arbitrary `X-Real-IP` header.
  const realIp = readHeader(headers, 'x-real-ip')?.trim();
  if (realIp && isIP(realIp)) return realIp;

  return null;
}
