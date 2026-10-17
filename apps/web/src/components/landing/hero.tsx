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
    <section className="relative pt-16">
      <div className={cn(COLUMN, GUTTER, 'pb-14 pt-16 sm:pb-16 sm:pt-20')}>
        <h1 className="max-w-4xl text-balance text-[clamp(2.25rem,5.2vw,4.5rem)] font-semibold leading-[1] tracking-[-0.045em] text-foreground">
          From first thought <span className="text-foreground-muted">to shipped product.</span>
        </h1>

        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <p className="max-w-xl text-pretty text-base leading-7 text-foreground-secondary">
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
  'flex shrink-0 items-center gap-2.5 whitespace-nowrap text-[15px] font-medium tracking-[-0.01em] text-foreground-muted transition-colors hover:text-foreground-secondary';

/**
 * One copy of the provider list. The marquee renders it twice; trailing
 * padding equal to the gap keeps the seam between copies the same width as
 * every other gap, so sliding by exactly -50% loops without a jump.
 */
function ProviderList({ hidden = false }: { hidden?: boolean }) {
  return (
    <ul
      aria-hidden={hidden || undefined}
      className={cn(
        'flex shrink-0 items-center gap-x-14 pr-14 motion-reduce:shrink motion-reduce:flex-wrap motion-reduce:gap-y-6 motion-reduce:pr-0',
        hidden && 'motion-reduce:hidden',
      )}
    >
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
  );
}

export function ProviderRow() {
  return (
    <Section bodyClassName="py-12 sm:py-14">
      <div className="grid gap-8 lg:grid-cols-[160px_1fr] lg:items-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-foreground-muted">
          Works with
        </p>
        <div className="overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)] motion-reduce:[mask-image:none]">
          <div className="animate-marquee flex w-max hover:[animation-play-state:paused] motion-reduce:w-full motion-reduce:animate-none">
            <ProviderList />
            <ProviderList hidden />
          </div>
        </div>
      </div>
    </Section>
  );
}
