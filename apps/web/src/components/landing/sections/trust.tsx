import { Accessibility, KeyRound, Lock, Network, ShieldCheck, Users, Webhook } from 'lucide-react';
import pkg from '../../../../package.json';
import { Section, SectionHeading } from '../primitives';
import { ByokFilm } from '../demo/films';

const SECURITY = [
  {
    Icon: Lock,
    title: 'Keys encrypted at rest',
    copy: 'Provider keys are sealed with AES-256-GCM per workspace. Settings only ever shows you the masked value back.',
  },
  {
    Icon: Network,
    title: 'SSRF-guarded transport',
    copy: 'Every provider call goes through a vetted fetch with redirect, size and timeout caps, custom and self-hosted endpoints included.',
  },
  {
    Icon: ShieldCheck,
    title: 'Sandboxed preview',
    copy: 'Generated apps run in a browser-based Node runtime inside a sandboxed frame, never on the Sovereign host.',
  },
  {
    Icon: Users,
    title: 'Real access control',
    copy: 'Every project procedure checks OWNER, EDITOR or VIEWER. Organization roles add an owner, admins and members on top.',
  },
  {
    Icon: Webhook,
    title: 'Sign in your way',
    copy: 'Email and password, Google or GitHub. Sessions, password resets, login-attempt throttling and audit events are handled for you.',
  },
  {
    Icon: Accessibility,
    title: 'Accessibility in the loop',
    copy: 'An axe collector runs inside the preview after every change and reports violations back into the workspace.',
  },
];

const TRUST = [
  { Icon: KeyRound, label: 'AES-256-GCM at rest', copy: 'Keys are encrypted per workspace.' },
  { Icon: ShieldCheck, label: 'SSRF-guarded transport', copy: 'Every provider call is vetted.' },
  { Icon: Lock, label: 'No platform credits', copy: 'You pay the provider directly.' },
];

/** `16.4.0` from a pinned or caret range, trimmed to major.minor. */
function minor(range: string): string {
  return range
    .replace(/^[^\d]*/, '')
    .split('.')
    .slice(0, 2)
    .join('.');
}

/** Read from the app's own manifest, so the strip cannot drift from what ships. */
const STACK = [
  { label: 'Next.js', value: minor(pkg.dependencies.next) },
  { label: 'React', value: minor(pkg.dependencies.react) },
  { label: 'tRPC', value: minor(pkg.dependencies['@trpc/server']) },
  { label: 'Prisma', value: minor(pkg.dependencies['@prisma/client']) },
  { label: 'PostgreSQL', value: 'managed' },
  { label: 'Turborepo', value: 'monorepo' },
];

export function ByokSection() {
  return (
    <Section id="byok">
      <div className="grid items-start gap-14 lg:grid-cols-[1.15fr_0.85fr] lg:gap-16">
        <div className="order-2 min-w-0 lg:order-1">
          <ByokFilm />
        </div>

        <div className="order-1 lg:order-2">
          <SectionHeading
            index="05"
            eyebrow="Bring your own keys"
            title="Pay the provider. Keep the leverage."
            copy="Sovereign is not a reseller. There are no credits, no markups and no metered middleman. You connect the providers you already use, and the composer can switch between any of them per request."
          />
          <ul className="mt-10 divide-y divide-border border-y border-border">
            {TRUST.map(({ Icon, label, copy }) => (
              <li key={label} className="flex gap-4 py-5">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-foreground-secondary" />
                <div>
                  <p className="text-sm font-medium text-foreground">{label}</p>
                  <p className="mt-1 text-[13px] leading-6 text-foreground-muted">{copy}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}

export function SecuritySection() {
  return (
    <Section id="security">
      <SectionHeading
        index="06"
        eyebrow="Security and architecture"
        title="The unglamorous parts, done properly."
        copy="Your keys, your code and your prompts are the whole product. Here is what stands between them and anyone else."
      />

      <ul className="mt-14 grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
        {SECURITY.map(({ Icon, title, copy }) => (
          <li key={title} className="bg-background p-6 sm:p-8">
            <Icon className="h-4 w-4 text-foreground-secondary" />
            <h3 className="mt-5 text-base font-semibold tracking-[-0.02em] text-foreground">
              {title}
            </h3>
            <p className="mt-2 text-[13px] leading-6 text-foreground-muted">{copy}</p>
          </li>
        ))}
      </ul>

      {/* Hangs off the grid above: its bottom rule is this strip's top. */}
      <div className="grid border-x border-b border-border lg:grid-cols-[200px_1fr]">
        <p className="flex items-center border-b border-border px-6 py-4 font-mono text-[11px] uppercase tracking-[0.08em] text-foreground-muted sm:px-8 lg:border-b-0 lg:border-r">
          Built on
        </p>
        <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
          {STACK.map((item) => (
            <div key={item.label} className="bg-background px-6 py-4">
              <dt className="text-[13px] text-foreground">{item.label}</dt>
              <dd className="mt-0.5 font-mono text-[11px] text-foreground-muted">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}
