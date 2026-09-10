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
                background: '#231D18',
                color: '#F5F0EB',
                border: '1px solid #3D3229',
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
