import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';
import { Section, SectionHeading, primaryButton, secondaryButton } from '../primitives';
import { FaqItem } from './faq-item';

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
      'Functions, database and app auth',
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
      'Team permissions and roles',
      'Shared organizations',
      'Priority support',
    ],
    cta: 'Start free trial',
  },
];

const FAQS = [
  {
    q: 'Do I need a Sovereign plan to use my own API key?',
    a: 'No. Bring-your-own-key is the only model. Connect a provider in Settings and the models it returns are available in the composer immediately. Pricing covers the workspace, never your tokens. You are billed by the provider, at their price.',
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
    a: 'Yes, that is the point. The Code tab shows the real source, you can sync the repository to GitHub, and every project exports the full TypeScript codebase. There is no rendering format you cannot read.',
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
    <Section id="pricing">
      <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
        <SectionHeading
          index="07"
          eyebrow="Pricing"
          title="Pay for the workspace. Not the tokens."
          copy="Every plan runs on your own provider keys, so your AI spend stays exactly where you can see it. The subscription is for the product around it."
        />
        <p className="max-w-xs text-sm leading-6 text-foreground-muted">
          Every plan includes code ownership, encrypted keys, and the freedom to leave whenever you
          want.
        </p>
      </div>

      <ul className="mt-14 grid gap-px border border-border bg-border lg:grid-cols-3">
        {PLANS.map((plan) => (
          <li key={plan.name} className="flex flex-col bg-background p-6 sm:p-8">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-foreground">{plan.name}</h3>
              {plan.featured && (
                <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.08em] text-foreground-secondary">
                  <span aria-hidden className="h-1.5 w-1.5 bg-primary" />
                  Recommended
                </span>
              )}
            </div>
            <p className="mt-8 flex items-baseline gap-1.5">
              <span className="text-5xl font-semibold tabular-nums tracking-[-0.045em] text-foreground">
                {plan.price}
              </span>
              <span className="text-sm text-foreground-muted">/ month</span>
            </p>
            <p className="mt-3 text-sm text-foreground-muted">{plan.line}</p>
            <ul className="mb-10 mt-8 space-y-3 border-t border-border pt-8">
              {plan.features.map((feature) => (
                <li
                  key={feature}
                  className="flex items-start gap-2.5 text-sm text-foreground-secondary"
                >
                  <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" />
                  {feature}
                </li>
              ))}
            </ul>
            <Link
              href="/auth/signin"
              className={cn(plan.featured ? primaryButton : secondaryButton, 'mt-auto w-full')}
            >
              {plan.cta}
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function FaqSection() {
  return (
    <Section id="faq">
      <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
        <SectionHeading
          index="08"
          eyebrow="Questions"
          title="The things people ask first."
          copy="If something here is still unclear, the fastest answer is to connect a key and try it. The free plan needs nothing from you."
        />

        <div className="divide-y divide-border border-y border-border">
          {FAQS.map((faq) => (
            <FaqItem key={faq.q} q={faq.q}>
              {faq.a}
            </FaqItem>
          ))}
        </div>
      </div>
    </Section>
  );
}

export function FinalCta() {
  return (
    <Section bodyClassName="py-24 sm:py-32">
      <div className="grid gap-10 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <h2 className="max-w-3xl text-balance text-[clamp(2.25rem,5vw,4rem)] font-semibold leading-[1.02] tracking-[-0.045em] text-foreground">
            Your next product is closer than it looks.
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-foreground-muted">
            Create a project, connect a model key, describe the thing. Keep every line of code you
            make along the way.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link href="/auth/signin" className={cn(primaryButton, 'group')}>
            Start building free
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link href="/auth/signup" className={secondaryButton}>
            Create an account
          </Link>
        </div>
      </div>
    </Section>
  );
}
