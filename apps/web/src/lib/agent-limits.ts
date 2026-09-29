/**
 * Operator knobs for the agent loop, parsed once per process.
 *
 * BYOK runs carry **no default limits**: the user pays for the tokens, so a run
 * ends when the model finishes or something with a signal stops it — the chat's
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

/**
 * Consecutive non-mutating turns before the run stops, or `Infinity` when the
 * guard is off — which is the default. Reading files, thinking out loud and
 * checking the build are all legitimate turns that may repeat many times over.
 */
export function resolveNoProgressGuard(raw: string | undefined): number {
  return resolveOptionalLimit(raw) ?? Number.POSITIVE_INFINITY;
}
