import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array));
}

export function middleware(_request: NextRequest) {
  const nonce = generateNonce();
  const response = NextResponse.next();

  // Client-side navigation preserves the current document's isolation state.
  // Every app entry point must therefore be isolated before it can navigate to
  // a project and boot WebContainer workers that transfer SharedArrayBuffer.
  response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');

  // Content Security Policy
  const isDev = process.env.NODE_ENV === 'development';

  const cspDirectives = [
    `default-src 'self'`,
    isDev
      ? `script-src 'self' 'unsafe-eval' 'unsafe-inline'`
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self'`,
    `connect-src 'self' https://*.vercel.app https://*.e2b.dev https://*.stackblitz.com https://stackblitz.com https://*.webcontainer-api.io ws: wss:`,
    `frame-src 'self' https://*.e2b.dev https://*.vercel.app https://*.stackblitz.com https://stackblitz.com https://*.webcontainer-api.io`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    ...(isDev ? [] : [`upgrade-insecure-requests`]),
  ].join('; ');

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

  // Pass nonce to the application
  response.headers.set('X-Nonce', nonce);

  return response;
}

export const config = {
  matcher: [
    // Match all routes except static files, favicon, and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
