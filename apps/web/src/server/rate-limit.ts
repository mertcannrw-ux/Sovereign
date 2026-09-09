/**
 * Rate limiting with Upstash Redis sliding window.
 * Falls back to per-instance in-memory limits when Upstash is not configured
 * or unreachable, so an outage can never brick sign-in/registration.
 */

import { env } from '@/env';
import { createHmac } from 'node:crypto';

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

const devBuckets = new Map<string, { count: number; resetAt: number }>();

function evictExpiredDevBuckets(now: number): void {
  for (const [key, bucket] of devBuckets) {
    if (now > bucket.resetAt) devBuckets.delete(key);
  }
}

function devSlidingWindow(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  evictExpiredDevBuckets(now);
  const bucket = devBuckets.get(key);

  if (!bucket || now > bucket.resetAt) {
    devBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: config.limit - 1, resetAt: now + windowMs };
  }

  bucket.count++;
  const allowed = bucket.count <= config.limit;
  return {
    allowed,
    remaining: Math.max(0, config.limit - bucket.count),
    resetAt: bucket.resetAt,
  };
}

// ─── Upstash sliding window ──────────────────────────────

// Emitted once per process: an Upstash outage must not lock every user out of
// sign-in/registration, so we fall back to the in-memory limiter (per-instance,
// still functional) instead of denying everything in production.
let warnedUpstashDown = false;

function onUpstashUnavailable(reason: string): void {
  if (process.env.NODE_ENV === 'production' && !warnedUpstashDown) {
    warnedUpstashDown = true;
    console.warn(
      `[rate-limit] Upstash unreachable (${reason}); falling back to per-instance in-memory limits.`,
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
    });
  } catch {
    onUpstashUnavailable('network error');
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
  prompt: { limit: 30, windowSeconds: 60 }, // 30 per minute
  build: { limit: 10, windowSeconds: 60 * 5 }, // 10 per 5 min
  deploy: { limit: 5, windowSeconds: 60 * 10 }, // 5 per 10 min
  apiKeyTest: { limit: 10, windowSeconds: 60 }, // 10 per minute
  dbQuery: { limit: 60, windowSeconds: 60 }, // 60 per minute
  agentRun: { limit: 20, windowSeconds: 60 * 5 }, // 20 per 5 min
} as const satisfies Record<string, RateLimitConfig>;

export type RateLimitKey = keyof typeof RATE_LIMITS;

// Emitted once per process so operators notice pre-auth buckets are keyed
// per-email (not per client IP) when no trusted proxy header is present.
let warnedTrustedProxy = false;

export async function checkRateLimit(
  key: RateLimitKey,
  identifier: string,
): Promise<RateLimitResult> {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.TRUSTED_PROXY !== 'true' &&
    !warnedTrustedProxy
  ) {
    warnedTrustedProxy = true;
    console.warn(
      '[rate-limit] TRUSTED_PROXY is not set. Requests are seen as 127.0.0.1, so pre-auth ' +
        'limits (register/signIn) are keyed per email instead of per client IP. Set ' +
        'TRUSTED_PROXY=true behind your proxy so limits are enforced per client IP.',
    );
  }

  const config = RATE_LIMITS[key];
  const redisKey = `rl:${key}:${identifier}`;
  return upstashSlidingWindow(redisKey, config);
}

/**
 * Hash an IP address for privacy-preserving rate limiting.
 * Keyed HMAC-SHA256 so clients cannot precompute the rate-limit key for a
 * forged IP header.
 */
export function hashIp(ip: string): string {
  const secret = env.NEXTAUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('NEXTAUTH_SECRET must be set for IP hashing');
    }
  }
  return createHmac('sha256', secret || 'dev-secret-key-fallback')
    .update(ip)
    .digest('hex')
    .slice(0, 32);
}
