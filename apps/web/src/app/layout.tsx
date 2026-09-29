import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Inter } from 'next/font/google';
import { cn } from '@app-builder/ui/utils';
import { Providers } from '@/components/providers';
import './globals.css';

/**
 * design.md §3 fixes the family as Inter. Loading it here (rather than
 * assuming a system fallback) is what makes the marketing display sizes
 * land on the metrics the type scale was tuned against.
 */
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'Sovereign — Build anything with AI. Bring your own key.',
  description:
    'The BYOK AI app builder. Combine the power of AI with your own API keys. No credits, no lock-in. Build, edit, and deploy full-stack applications.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className={cn('min-h-screen font-sans')}>
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
