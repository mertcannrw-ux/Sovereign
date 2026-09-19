import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';

/** Page prefixes that require a session. API routes enforce their own authz. */
const PROTECTED_PREFIXES = ['/dashboard', '/project', '/settings'];

function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array));
}

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Page-level gate: UX plus defense in depth. Middleware only sees the JWT (no
  // database), so token revocation still happens in the API routes, which
  // compare sessionVersion against the database on every call.
  if (isProtectedPath(pathname)) {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });
    if (!token) {
      const signInUrl = new URL('/auth/signin', request.url);
      signInUrl.searchParams.set('callbackUrl', `${pathname}${search}`);
      return NextResponse.redirect(signInUrl);
    }
  }

  const nonce = generateNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const isDev = process.env.NODE_ENV === 'development';
  const connectSrc = [
    `'self'`,
    'https://*.vercel.app',
    'https://*.e2b.dev',
    'https://*.stackblitz.com',
    'https://stackblitz.com',
    'https://*.webcontainer-api.io',
    // Dev-only: the Next.js HMR socket. Production app code opens no socket of
    // its own — preview sockets live inside the sandboxed iframe's own origin.
    ...(isDev ? ['ws:', 'wss:'] : []),
  ].join(' ');
  const cspDirectives = [
    `default-src 'self'`,
    isDev
      ? `script-src 'self' 'unsafe-eval' 'unsafe-inline'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self'`,
    `connect-src ${connectSrc}`,
    `frame-src 'self' https://*.e2b.dev https://*.vercel.app https://*.stackblitz.com https://stackblitz.com https://*.webcontainer-api.io`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    ...(isDev ? [] : [`upgrade-insecure-requests`]),
  ].join('; ');

  // Next.js reads CSP + nonce from the *request* so it can stamp framework scripts.
  requestHeaders.set('Content-Security-Policy', cspDirectives);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Client-side navigation preserves the current document's isolation state.
  // Every app entry point must therefore be isolated before it can navigate to
  // a project and boot WebContainer workers that transfer SharedArrayBuffer.
  response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Content-Security-Policy', cspDirectives);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  );
  response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  response.headers.set('X-XSS-Protection', '0');
  response.headers.set('X-Nonce', nonce);

  return response;
}

export const config = {
  matcher: [
    // Match all routes except static files, favicon, and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
