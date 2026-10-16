import Link from 'next/link';
import { ArrowRight, Plug } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';
import { BuildFilm } from './demo/films';
import { COLUMN, GUTTER, Section, primaryButton, secondaryButton } from './primitives';
import { PROVIDER_LOGOS, ProviderMark } from './provider-logos';

/**
 * Static by design: the headline is the largest paint on the page, so it
 * renders visible from the server instead of waiting on JS to fade in.
 */
export function Hero() {
  return (
    <section className="relative pt-14">
      <div className={cn(COLUMN, GUTTER, 'pb-16 pt-20 sm:pb-20 sm:pt-28')}>
        <h1 className="max-w-5xl text-balance text-[clamp(2.75rem,6.6vw,5.75rem)] font-semibold leading-[0.98] tracking-[-0.045em] text-foreground">
          From first thought <span className="text-foreground-muted">to shipped product.</span>
        </h1>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <p className="max-w-xl text-pretty text-base leading-7 text-foreground-secondary sm:text-lg sm:leading-8">
            Sovereign is a full-stack AI workspace for people who own their tools. Describe the app,
            watch every file land, click any element to restyle it, then keep the code.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/auth/signin" className={cn(primaryButton, 'group')}>
              Build your first app
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a href="#demo" className={secondaryButton}>
              Watch the build
            </a>
          </div>
        </div>
      </div>

      <div id="demo" className={cn(COLUMN, 'scroll-mt-20 px-3 pb-16 sm:px-8 sm:pb-20 lg:px-12')}>
        <BuildFilm />
      </div>
    </section>
  );
}

const providerItem =
  'flex items-center gap-2.5 text-[15px] font-medium tracking-[-0.01em] text-foreground-muted transition-colors hover:text-foreground-secondary';

export function ProviderRow() {
  return (
    <Section bodyClassName="py-12 sm:py-14">
      <div className="grid gap-8 lg:grid-cols-[160px_1fr] lg:items-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-foreground-muted">
          Works with
        </p>
        <ul className="grid grid-cols-2 gap-x-6 gap-y-7 sm:grid-cols-4 lg:flex lg:items-center lg:justify-between">
          {PROVIDER_LOGOS.map((provider) => (
            <li key={provider.name} className={providerItem}>
              <ProviderMark d={provider.d} />
              {provider.name}
            </li>
          ))}
          <li className={providerItem}>
            <Plug aria-hidden className="h-5 w-5 shrink-0" strokeWidth={1.75} />
            Custom
          </li>
        </ul>
      </div>
    </Section>
  );
}
