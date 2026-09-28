'use client';

import { SessionProvider } from 'next-auth/react';
import { Toaster } from 'react-hot-toast';
import { ThemeProvider } from 'next-themes';
import { TRPCProvider } from '@/lib/trpc/react';

export function Providers({ children, nonce }: { children: React.ReactNode; nonce?: string }) {
  return (
    <SessionProvider>
      <TRPCProvider>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false} nonce={nonce}>
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: 'var(--background-subtle)',
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
                borderRadius: '0.5rem',
                fontSize: '0.875rem',
              },
            }}
          />
        </ThemeProvider>
      </TRPCProvider>
    </SessionProvider>
  );
}
