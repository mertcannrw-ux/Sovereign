/**
 * Where to go after signing in or up: a `callbackUrl` the middleware set (for
 * example an invite link), but only a path on this site. Anything else - an
 * absolute URL, a protocol-relative `//host`, a backslash trick - falls back,
 * so the parameter cannot be used to send people elsewhere.
 */
export function safeCallbackUrl(raw: string | null | undefined, fallback = '/dashboard'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  return raw;
}

/** `path` carrying the current page's safe callback along, e.g. sign in <-> sign up. */
export function withCallback(path: string, callbackUrl: string): string {
  return callbackUrl === '/dashboard'
    ? path
    : `${path}?callbackUrl=${encodeURIComponent(callbackUrl)}`;
}
