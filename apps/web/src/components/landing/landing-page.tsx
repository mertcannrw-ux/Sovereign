import { SiteHeader } from './chrome';
import { SiteFooter } from './footer';
import { Hero, ProviderRow } from './hero';
import { FrameRails } from './primitives';
import { ProductSection, WorkflowSection } from './sections/product';
import { TemplatesSection, VisualEditorSection } from './sections/visual';
import { ByokSection, SecuritySection } from './sections/trust';
import { FaqSection, FinalCta, PricingSection } from './sections/convert';

/**
 * Server-rendered composition. Only the header, the FAQ accordion and the
 * demo films hydrate; everything else ships as HTML.
 */
export function LandingPage() {
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground"
      >
        Skip to content
      </a>

      <div className="relative min-h-screen overflow-x-clip bg-background text-foreground">
        <FrameRails />
        <SiteHeader />

        <main id="main">
          <Hero />
          <ProviderRow />
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
    </>
  );
}
