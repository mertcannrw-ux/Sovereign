import type { Metadata } from 'next';
import { cn } from '@app-builder/ui/utils';
import { Providers } from '@/components/providers';
import './globals.css';



export const metadata: Metadata = {
  title: 'Sovereign — Build anything with AI. Bring your own key.',
  description:
    'The BYOK AI app builder. Combine the power of AI with your own API keys. No credits, no lock-in. Build, edit, and deploy full-stack applications.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={cn('min-h-screen font-sans')}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
