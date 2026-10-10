/**
 * Format-agnostic type guards for narrowing untrusted JSON/wire values.
 *
 * Deliberately dependency-free: the tool-call parser and the HTTP layer both
 * need them, and importing them from `./gateway-http` would drag the SSRF/DNS
 * stack into modules that only parse wire formats.
 *
 * All type-guarded to comply with the no-inline-cast-access rule.
 */

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isString(value: unknown): value is string {
  return typeof value === 'string';
}

export function safeString(value: unknown, fallback = ''): string {
  return isString(value) ? value : fallback;
}

export function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
}
