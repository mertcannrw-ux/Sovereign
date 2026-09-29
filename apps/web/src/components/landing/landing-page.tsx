'use client';

import { MotionConfig } from 'framer-motion';
import { SiteFooter, SiteHeader } from './chrome';
import { Hero, ProofStrip, ProviderMarquee } from './hero';
import { ProductSection, WorkflowSection } from './sections/product';
import { TemplatesSection, VisualEditorSection } from './sections/visual';
import { ByokSection, SecuritySection } from './sections/trust';
import { FaqSection, FinalCta, PricingSection } from './sections/convert';

export function LandingPage() {
  return (
    <MotionConfig reducedMotion="user">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <div className="min-h-screen overflow-hidden bg-background text-foreground selection:bg-primary selection:text-primary-foreground">
        <SiteHeader />

        <main id="main">
          <Hero />
          <ProviderMarquee />
          <div className="py-16 sm:py-20">
            <ProofStrip />
          </div>
          <ProductSection />
          <VisualEditorSection />
          <WorkflowSection />
          <TemplatesSection />
          <ByokSection />
          <SecuritySection />
          <PricingSection />
          <FaqSection />
          <FinalCta />
        </main>

        <SiteFooter />
      </div>
    </MotionConfig>
  );
}
