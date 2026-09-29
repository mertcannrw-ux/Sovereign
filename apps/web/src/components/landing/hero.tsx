'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { ArrowRight, Play } from 'lucide-react';
import { Aurora } from './backdrop';
import { AccentText, Stagger, StaggerItem, ease, reveal, stagger } from './primitives';
import { DemoPlayer } from './demo/demo-player';
import { buildScenes } from './demo/build-walkthrough';

const PROVIDERS = ['OpenAI', 'Anthropic', 'Google Gemini', 'Mistral', 'Groq', 'Ollama', 'Custom'];

export function Hero() {
  return (
    <section className="relative overflow-hidden pb-24 pt-28 sm:pb-32 sm:pt-32">
      <Aurora />

      {/* Reading scrim. The aurora is bright enough to lift the local
          background under the sub-copy, and `foreground-muted` is only rated
          against the flat page colour — so the text column gets its own
          falloff back toward `background`. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[700px] bg-[radial-gradient(ellipse_46%_58%_at_50%_40%,rgba(9,9,9,0.82),rgba(9,9,9,0.38)_62%,transparent_82%)]"
      />

      <div className="relative z-10 mx-auto max-w-[1320px] px-5 text-center sm:px-8">
        <motion.div variants={stagger} initial="hidden" animate="visible">
          <motion.h1
            variants={reveal}
            className="mx-auto max-w-5xl text-balance text-[clamp(2.75rem,7.4vw,6.5rem)] font-extrabold leading-[0.98] tracking-[-0.06em]"
          >
            From first thought
            <br />
            <AccentText>to shipped product.</AccentText>
          </motion.h1>

          <motion.p
            variants={reveal}
            className="mx-auto mt-7 max-w-2xl text-balance text-base leading-7 text-foreground-secondary sm:text-lg sm:leading-8"
          >
            Sovereign is a full-stack AI workspace for people who own their tools. Describe the app,
            watch every file land, click any element to restyle it — then keep the code.
          </motion.p>

          <motion.div
            variants={reveal}
            className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Link
              href="/auth/signin"
              className="h-12 group flex w-full items-center justify-center gap-2 rounded-full bg-primary px-7 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.02] sm:w-auto"
            >
              Build your first app
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <a
              href="#demo"
              className="h-12 flex w-full items-center justify-center gap-2 rounded-full border border-border-strong bg-white/[0.03] px-7 text-sm font-medium text-foreground transition-colors hover:bg-white/[0.08] sm:w-auto"
            >
              <Play className="h-3.5 w-3.5 fill-white" />
              Watch the build
            </a>
          </motion.div>
        </motion.div>
      </div>

      <div
        id="demo"
        className="relative z-10 mx-auto mt-20 max-w-[1240px] scroll-mt-24 px-3 sm:mt-28 sm:px-6"
      >
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 1, delay: 0.4, ease }}
        >
          <div className="landing-orb pointer-events-none absolute -inset-x-24 bottom-0 top-1/3 -z-10 blur-2xl" />
          <DemoPlayer
            scenes={buildScenes}
            label="Sovereign product walkthrough: a prompt becomes a running app, an element is restyled visually, the code is inspected and a version is restored."
            posterSceneId="preview"
            surfaceClassName="h-[520px] sm:h-[600px] lg:h-[660px]"
          />
        </motion.div>
      </div>
    </section>
  );
}

export function ProviderMarquee() {
  const row = [...PROVIDERS, ...PROVIDERS];
  return (
    <section className="border-y border-white/[0.08] bg-background-subtle/40 py-9">
      <div className="mx-auto flex max-w-[1320px] flex-col items-center gap-6 px-5 sm:px-8 lg:flex-row lg:justify-between">
        <p className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-foreground-muted">
          Use the intelligence you trust
        </p>
        <div className="landing-marquee w-full overflow-hidden lg:min-w-0 lg:max-w-[880px] lg:flex-1">
          <div className="animate-marquee flex w-max items-center gap-10 sm:gap-14">
            {row.map((provider, index) => (
              <span
                key={`${provider}-${index}`}
                className="whitespace-nowrap text-sm font-semibold tracking-[-0.02em] text-foreground-muted"
              >
                {provider}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Three-up proof strip used directly under the hero film. */
export function ProofStrip() {
  const stats = [
    { value: '7', label: 'model providers, bring your own key' },
    { value: '21', label: 'starter templates across 7 categories' },
    { value: '100%', label: 'of the generated code is yours' },
  ];
  return (
    <Stagger className="mx-auto grid max-w-[1320px] gap-4 px-5 sm:grid-cols-3 sm:px-8">
      {stats.map((stat) => (
        <StaggerItem
          key={stat.label}
          className="rounded-2xl border border-border bg-background-subtle p-6"
        >
          <p className="text-4xl font-extrabold tracking-[-0.05em] text-primary">{stat.value}</p>
          <p className="mt-2 text-sm leading-6 text-foreground-muted">{stat.label}</p>
        </StaggerItem>
      ))}
    </Stagger>
  );
}
