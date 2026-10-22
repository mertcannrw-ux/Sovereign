import { TRPCError } from '@trpc/server';
import { checkRateLimit, type RateLimitKey } from '@/server/rate-limit';

/**
 * Throw `TOO_MANY_REQUESTS` when `identity` has spent `key`'s budget.
 *
 * Shared by every router that meters a mutation so the retry wording and the
 * `retryAfter` rounding do not drift between endpoints.
 */
export async function enforceRateLimit(
  key: RateLimitKey,
  identity: string,
  message: string,
): Promise<void> {
  const rate = await checkRateLimit(key, identity);
  if (rate.allowed) return;
  const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
  throw new TRPCError({
    code: 'TOO_MANY_REQUESTS',
    message: `${message} Try again in ${retryIn}s.`,
  });
}
