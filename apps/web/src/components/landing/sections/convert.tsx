'use client';

import Link from 'next/link';
import { ArrowRight, Check, Plus } from 'lucide-react';
import { Reveal, SectionHeading, Stagger, StaggerItem } from '../primitives';

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    line: 'For finding out whether this works for you.',
    features: [
      '3 active projects',
      'Full visual editor',
      'Complete code export',
      'All 21 templates',
    ],
    cta: 'Start building',
  },
  {
    name: 'Pro',
    price: '$25',
    line: 'For builders who ship every week.',
    features: [
      'Unlimited projects',
      'GitHub sync',
      'Custom domains',
      'Functions, database & app auth',
      'Unlimited version history',
    ],
    cta: 'Start free trial',
    featured: true,
  },
  {
    name: 'Business',
    price: '$50',
    line: 'For product teams moving in parallel.',
    features: [
      '10 collaborators',
      'Team permissions & roles',
      'Shared organizations',
      'Priority support',
    ],
    cta: 'Start free trial',
  },
];

const FAQS = [
  {
    q: 'Do I need a Sovereign plan to use my own API key?',
    a: 'No. Bring-your-own-key is the only model. Connect a provider in Settings and the models it returns are available in the composer immediately. Pricing covers the workspace, never your tokens — you are billed by the provider, at their price.',
  },
  {
    q: 'Which providers are supported?',
    a: 'OpenAI, Anthropic, Google Gemini, Mistral and Groq out of the box, plus Ollama and any custom OpenAI-compatible endpoint with its own base URL. Keys are validated directly against the provider when you add them.',
  },
  {
    q: 'What exactly does the visual editor change?',
    a: 'It changes your code. A build plugin stamps a data-ve-id onto your JSX, so clicking an element in the preview resolves to the component that rendered it. Your sentence becomes a normal edit, streamed into the Code tab and saved as a new version.',
  },
  {
    q: 'Can I get my code out?',
    a: 'Yes — that is the point. The Code tab shows the real source, you can sync the repository to GitHub, and every project exports the full TypeScript codebase. There is no rendering format you cannot read.',
  },
  {
    q: 'What happens if a change breaks something?',
    a: 'Every run writes a snapshot. Open any version from the timeline, compare the files that changed, and restore the workspace to that exact state in one click.',
  },
  {
    q: 'Where does my code actually run?',
    a: 'Generated apps run in a browser-based Node runtime inside a sandboxed frame while you preview them. Sovereign never executes your project on its own host. Deployments are created through Vercel once you connect credentials.',
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="relative scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
        <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
          <SectionHeading
            title="Pay for the workspace. Not the tokens."
            copy="Every plan runs on your own provider keys, so your AI spend stays exactly where you can see it. The subscription is for the product around it."
          />
          <Reveal className="shrink-0">
            <p className="max-w-xs text-sm leading-6 text-foreground-muted">
              Every plan includes code ownership, encrypted keys, and the freedom to leave whenever
              you want.
            </p>
          </Reveal>
        </div>

        <Stagger className="mt-14 grid gap-4 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <StaggerItem
              key={plan.name}
              className={`relative flex min-h-[440px] flex-col overflow-hidden rounded-3xl border p-7 sm:p-8 ${
                plan.featured
                  ? 'border-primary/45 bg-primary text-primary-foreground'
                  : 'border-border bg-background-subtle'
              }`}
            >
              {plan.featured && (
                <>
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-10 top-0 h-px bg-primary"
                  />
                  <span className="absolute right-6 top-6 rounded-full bg-primary-foreground px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                    Most popular
                  </span>
                </>
              )}
              <p className="text-sm font-semibold">{plan.name}</p>
              <div className="mt-8 flex items-end gap-1.5">
                <span className="text-5xl font-extrabold tracking-[-0.055em]">{plan.price}</span>
                <span
                  className={`mb-1.5 text-sm ${
                    plan.featured ? 'text-primary-foreground/60' : 'text-foreground-muted'
                  }`}
                >
                  / month
                </span>
              </div>
              <p
                className={`mt-3 text-sm ${
                  plan.featured ? 'text-primary-foreground/70' : 'text-foreground-muted'
                }`}
              >
                {plan.line}
              </p>
              <ul className="mt-8 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm">
                    <Check className="mt-0.5 h-4 w-4 shrink-0" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href="/auth/signin"
                className={`mt-auto flex h-12 items-center justify-center rounded-full text-sm font-semibold transition-transform hover:scale-[1.01] ${
                  plan.featured ? 'bg-primary-foreground text-primary' : 'bg-white text-black'
                }`}
              >
                {plan.cta}
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

export function FaqSection() {
  return (
    <section
      id="faq"
      className="relative scroll-mt-20 border-t border-white/[0.08] bg-background-subtle/50 py-24 sm:py-32"
    >
      <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
          <SectionHeading
            title="The things people ask first."
            copy="If something here is still unclear, the fastest answer is to connect a key and try it — the free plan needs nothing from you."
          />

          <Stagger className="divide-y divide-border border-y border-border" step={0.05}>
            {FAQS.map((faq) => (
              <StaggerItem key={faq.q}>
                <details className="group py-5">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-6 rounded-lg text-left text-[15px] font-semibold tracking-[-0.02em] text-foreground marker:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40">
                    {faq.q}
                    <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border text-foreground-muted transition-transform duration-300 group-open:rotate-45">
                      <Plus className="h-3.5 w-3.5" />
                    </span>
                  </summary>
                  <p className="mt-3 max-w-2xl text-sm leading-7 text-foreground-muted">{faq.a}</p>
                </details>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="px-5 py-20 sm:px-8 sm:py-28">
      <Reveal className="landing-rim landing-cta relative mx-auto max-w-[1320px] overflow-hidden rounded-3xl border border-border px-6 py-20 text-center sm:px-12 sm:py-28">
        <div
          aria-hidden
          className="landing-grain pointer-events-none absolute inset-0 overflow-hidden"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_70%_at_50%_115%,rgba(184,255,90,0.3),transparent_62%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_45%_55%_at_18%_-10%,rgba(139,199,255,0.22),transparent_65%)]"
        />
        <div className="relative z-10">
          <h2 className="mx-auto max-w-3xl text-balance text-[clamp(2.25rem,5.4vw,4.25rem)] font-extrabold leading-[1.02] tracking-[-0.05em]">
            Your next product is closer than it looks.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-balance text-base leading-7 text-foreground-muted">
            Create a project, connect a model key, describe the thing. Keep every line of code you
            make along the way.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/auth/signin"
              className="h-12 group flex w-full items-center justify-center gap-2 rounded-full bg-primary px-7 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.02] sm:w-auto"
            >
              Start building free
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="/auth/signup"
              className="h-12 flex w-full items-center justify-center rounded-full border border-border-strong px-7 text-sm font-medium text-foreground transition-colors hover:bg-white/[0.06] sm:w-auto"
            >
              Create an account
            </Link>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
