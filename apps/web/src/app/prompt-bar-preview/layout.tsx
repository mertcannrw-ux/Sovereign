import type { Metadata } from 'next';

/**
 * Internal design playground. It must not be indexed or surfaced by search
 * engines: the concepts it shows are unreleased.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  title: 'Prompt bar preview',
};

export default function PromptBarPreviewLayout({ children }: { children: React.ReactNode }) {
  return children;
}
