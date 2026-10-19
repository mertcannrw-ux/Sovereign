'use client';

import { useEffect } from 'react';
import { colors, radius } from '@/styles/tokens';

/**
 * Catches errors thrown in the root layout, which `app/error.tsx` cannot.
 * Renders its own <html>/<body> and uses inline styles (token values, not
 * Tailwind) because the root layout - and therefore globals.css - may not have
 * loaded.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled global error:', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          background: colors.background.DEFAULT,
          color: colors.foreground.DEFAULT,
        }}
      >
        <div
          style={{
            display: 'flex',
            minHeight: '100vh',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div style={{ maxWidth: 420, padding: 32, textAlign: 'center' }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>
              Something went wrong
            </h1>
            <p style={{ marginBottom: 24 }}>An unexpected error occurred. Please try again.</p>
            <button
              onClick={reset}
              style={{
                background: colors.primary.DEFAULT,
                color: colors.primary.foreground,
                border: 'none',
                borderRadius: radius.control,
                padding: '8px 16px',
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
