/**
 * Rate limiting with Upstash Redis sliding window.
 * Falls through (allows all) when Upstash is not configured.
 */

import { env } from '@/env';

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

function devSlidingWindow(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
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

  const response = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(pipeline.map((cmd) => ({ cmd }))),
  });

  if (!response.ok) {
    // Fail open — allow the request if Redis is down
    return {
      allowed: true,
      remaining: config.limit,
      resetAt: now * 1000 + config.windowSeconds * 1000,
    };
  }

  const results = await response.json();
  const count = results[1]?.result ?? 0;

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

export async function checkRateLimit(
  key: RateLimitKey,
  identifier: string,
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[key];
  const redisKey = `rl:${key}:${identifier}`;
  return upstashSlidingWindow(redisKey, config);
}

/**
 * Hash an IP address for privacy-preserving rate limiting.
 */
export function hashIp(ip: string): string {
  // Simple hash — not cryptographic, just obfuscation for rate limit keys
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    const char = ip.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36);
}
