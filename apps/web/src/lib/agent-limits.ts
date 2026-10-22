/**
 * Operator knobs for the agent loop, parsed once per process.
 *
 * BYOK runs carry **no default limits**: the user pays for the tokens, so a run
 * ends when the model finishes or something with a signal stops it - the chat's
 * Stop button, lease ownership, or a provider/transport error. A hard-coded
 * step ceiling used to cut long builds mid-file (a 25-file app that needed 41
 * turns died with every file written and nothing verified), and a default
 * no-progress guard cut off legitimate read-heavy exploration.
 *
 * Operators who need a bound set the matching env var; unset, blank, zero,
 * negative and non-numeric values all mean "no limit".
 */
export function resolveOptionalLimit(raw: string | undefined): number | undefined {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

/** Vercel Hobby's function timeout ceiling; Pro/Enterprise allows more. */
export const VERCEL_HOBBY_MAX_DURATION = 300;

/**
 * `maxDuration` on the generate route must stay a numeric literal (Next
 * extracts it statically), so a Hobby deployment cannot lower it via env - it
 * must edit the literal, and Vercel itself rejects an illegal value at build
 * time. `VERCEL` is set on every plan (Hobby, Pro, Enterprise), so this cannot
 * distinguish them: it warns rather than throws, because a throw at module
 * scope would take the route (and the whole build) down on plans that accept
 * 800s perfectly well.
 */
export function warnIfMaxDurationExceedsHobby(maxDuration: number): void {
  if (process.env.VERCEL === '1' && maxDuration > VERCEL_HOBBY_MAX_DURATION) {
    console.warn(
      `[generate] maxDuration=${maxDuration}s exceeds Vercel Hobby's ${VERCEL_HOBBY_MAX_DURATION}s ceiling. ` +
        `On Hobby the deploy will fail: lower the literal in apps/web/src/app/api/generate/route.ts to ${VERCEL_HOBBY_MAX_DURATION}, or use a Pro plan.`,
    );
  }
}

/**
 * Consecutive non-mutating turns before the run stops, or `Infinity` when the
 * guard is off - which is the default. Reading files, thinking out loud and
 * checking the build are all legitimate turns that may repeat many times over.
 */
export function resolveNoProgressGuard(raw: string | undefined): number {
  return resolveOptionalLimit(raw) ?? Number.POSITIVE_INFINITY;
}
