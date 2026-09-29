'use client';

import {
  Accessibility,
  Database,
  KeyRound,
  Lock,
  Network,
  ShieldCheck,
  Users,
  Webhook,
} from 'lucide-react';
import { Aurora } from '../backdrop';
import { Reveal, SectionHeading, Stagger, StaggerItem } from '../primitives';
import { DemoPlayer } from '../demo/demo-player';
import { byokScenes, ByokTrustCard } from '../demo/closeup-videos';

const SECURITY = [
  {
    Icon: Lock,
    title: 'Keys encrypted at rest',
    copy: 'Provider keys are sealed with AES-256-GCM per workspace. Settings only ever shows you the masked value back.',
  },
  {
    Icon: Network,
    title: 'SSRF-guarded transport',
    copy: 'Every provider call goes through a vetted fetch with redirect, size and timeout caps — custom and self-hosted endpoints included.',
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

const STACK = [
  { label: 'Next.js', value: '16.3' },
  { label: 'React', value: '19.2' },
  { label: 'tRPC', value: '11.18' },
  { label: 'Prisma', value: '7.8' },
  { label: 'PostgreSQL', value: 'managed' },
  { label: 'Turbo', value: 'monorepo' },
];

export function ByokSection() {
  return (
    <section id="byok" className="relative scroll-mt-20 overflow-hidden py-24 sm:py-32">
      <Aurora intensity={0.75} grid={false} />
      {/* Reading scrim. The BYOK copy sits on the right, so the wash is
          mirrored and the colour stays behind the player. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(260deg,rgba(9,9,9,0.9)_0%,rgba(9,9,9,0.72)_38%,transparent_66%)]"
      />

      <div className="relative z-10 mx-auto max-w-[1320px] px-5 sm:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
          <Reveal className="order-2 min-w-0 lg:order-1">
            <DemoPlayer
              scenes={byokScenes}
              label="Bringing your own key: the AI Providers settings tab, a key being added, and the connected state."
              posterSceneId="connected"
              surfaceClassName="h-[440px] sm:h-[520px]"
            />
          </Reveal>

          <div className="order-1 lg:order-2">
            <SectionHeading
              title="Pay the provider. Keep the leverage."
              copy="Sovereign is not a reseller. There are no credits, no markups and no metered middleman — you connect the providers you already use, and the composer can switch between any of them per request."
            />
            <Reveal delay={0.1} className="mt-9">
              <ByokTrustCard />
            </Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

export function SecuritySection() {
  return (
    <section
      id="security"
      className="relative scroll-mt-20 border-y border-white/[0.08] bg-background-subtle/50 py-24 sm:py-32"
    >
      <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
        <SectionHeading
          title="The unglamorous parts, done properly."
          copy="Your keys, your code and your prompts are the whole product. Here is what stands between them and anyone else."
        />

        <Stagger className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SECURITY.map(({ Icon, title, copy }) => (
            <StaggerItem
              key={title}
              className="flex gap-4 rounded-2xl border border-border bg-background p-6 transition-colors duration-300 hover:border-border-strong"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/20 bg-primary/[0.08]">
                <Icon className="h-5 w-5 text-primary" />
              </span>
              <div>
                <h3 className="text-base font-semibold tracking-[-0.02em] text-foreground">
                  {title}
                </h3>
                <p className="mt-2 text-[13px] leading-6 text-foreground-muted">{copy}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>

        <Reveal className="mt-10 flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-background p-5">
          <span className="flex items-center gap-2 pr-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-muted">
            <Database className="h-3.5 w-3.5 text-primary" />
            Built on
          </span>
          {STACK.map((item) => (
            <span
              key={item.label}
              className="rounded-lg border border-border bg-background-subtle px-2.5 py-1.5 text-[11px] text-foreground-secondary"
            >
              {item.label} <span className="text-foreground-muted">{item.value}</span>
            </span>
          ))}
          <span className="ml-auto flex items-center gap-1.5 text-[11px] text-foreground-muted">
            <KeyRound className="h-3.5 w-3.5" />
            Keys never leave your workspace
          </span>
        </Reveal>
      </div>
    </section>
  );
}
