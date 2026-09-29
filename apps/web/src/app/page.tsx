import type { Metadata } from 'next';
import { LandingPage } from '@/components/landing/landing-page';

export const metadata: Metadata = {
  title: 'Sovereign — Build anything with AI. Bring your own key.',
  description:
    'The BYOK AI app builder. Describe a full-stack app, watch every file land, edit any element visually, and keep the code. No credits, no lock-in.',
  keywords: [
    'AI app builder',
    'bring your own key',
    'full-stack AI workspace',
    'visual editor',
    'Next.js code generator',
  ],
  openGraph: {
    title: 'Sovereign — From first thought to shipped product.',
    description:
      'A full-stack AI workspace with your own model keys. Build it, edit it visually, read the code, keep it.',
    type: 'website',
    siteName: 'Sovereign',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sovereign — From first thought to shipped product.',
    description:
      'A full-stack AI workspace with your own model keys. Build it, edit it visually, read the code, keep it.',
  },
  robots: { index: true, follow: true },
};

export default function Page() {
  return <LandingPage />;
}
