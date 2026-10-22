/**
 * Where to go after signing in or up: a `callbackUrl` the middleware set (for
 * example an invite link), but only a path on this site. Anything else - an
 * absolute URL, a protocol-relative `//host`, a backslash trick - falls back,
 * so the parameter cannot be used to send people elsewhere.
 */

/**
 * Characters the WHATWG URL parser strips from anywhere in a URL. A value such
 * as `/%09/evil.com` therefore *parses* as `//evil.com`, i.e. a
 * protocol-relative URL to another origin, even though the raw string starts
 * with a single slash. Reject them before any other check.
 */
const URL_STRIPPED_CONTROL = /[\u0000-\u001f\u007f]/;

export function safeCallbackUrl(raw: string | null | undefined, fallback = '/dashboard'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  if (URL_STRIPPED_CONTROL.test(raw)) return fallback;

  // Belt and braces: resolve against a sentinel origin and require the result
  // to stay on it. This rejects every encoding trick the checks above miss.
  const sentinel = 'https://safe.invalid';
  try {
    const resolved = new URL(raw, sentinel);
    if (resolved.origin !== sentinel) return fallback;
    const normalized = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    // Dot-segment removal runs after the checks above and can turn a value that
    // passed them into a protocol-relative one: `/.//evil.test` normalizes to
    // `//evil.test`, which the router would treat as another origin. Reject the
    // normalized form, not just the raw input.
    if (!normalized.startsWith('/') || normalized.startsWith('//')) return fallback;
    return normalized;
  } catch {
    return fallback;
  }
}

/** `path` carrying the current page's safe callback along, e.g. sign in <-> sign up. */
export function withCallback(path: string, callbackUrl: string): string {
  return callbackUrl === '/dashboard'
    ? path
    : `${path}?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}
