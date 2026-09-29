'use client';

import { ArrowRight, Clock, MousePointerClick, Sparkles } from 'lucide-react';
import { TemplateSketch } from '@/app/dashboard/templates/template-sketch';
import { templates } from '@/data/templates';
import { templateGuides } from '@/data/templates';
import type { TemplateCategory } from '@/data/templates';
import { Aurora } from '../backdrop';
import { Eyebrow, Reveal, SectionHeading, Stagger, StaggerItem } from '../primitives';
import { DemoPlayer } from '../demo/demo-player';
import { visualEditorScenes } from '../demo/closeup-videos';

/* ---------------------------------------------------------------------------
 * The visual editor close-up, and the template catalog.
 *
 * The catalog renders the same `TemplateSketch` wireframes the signed-in
 * Templates page draws, using that page's per-category accent palette, and
 * the template rows are the real records from `data/templates.ts`.
 * ------------------------------------------------------------------------- */

/** Per-category accent + surface, lifted from `dashboard/templates/page.tsx`. */
const CATEGORY_ART: Record<TemplateCategory, { accent: string; surface: string }> = {
  All: { accent: '#B8FF5A', surface: '#1A2410' },
  Productivity: { accent: '#B8FF5A', surface: '#1A2410' },
  'E-commerce': { accent: '#FFBF7A', surface: '#26170C' },
  SaaS: { accent: '#8BC7FF', surface: '#0C1B26' },
  Content: { accent: '#D6A7FF', surface: '#201126' },
  'Internal Tools': { accent: '#FFE06A', surface: '#251F09' },
  'Health & Fitness': { accent: '#FF8F9E', surface: '#270D12' },
  Education: { accent: '#77E0D3', surface: '#092320' },
};

const TOOL_CHIPS = [
  { label: 'Text', prompt: 'Change the text to ' },
  { label: 'Color', prompt: 'Change the colors: ' },
  { label: 'Typography', prompt: 'Update the typography: ' },
  { label: 'Spacing', prompt: 'Adjust the spacing: ' },
  { label: 'Layout', prompt: 'Change the layout and alignment: ' },
  { label: 'Border', prompt: 'Change the border and corner radius: ' },
  { label: 'Effects', prompt: 'Add or change the visual effects: ' },
];

export function VisualEditorSection() {
  return (
    <section id="editor" className="relative scroll-mt-20 overflow-hidden py-24 sm:py-32">
      <Aurora intensity={0.6} grid={false} />
      {/* Reading scrim behind the copy column — the in-section aurora is
          dimmer than the hero's but it still lifts the local background
          under body text. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[linear-gradient(100deg,rgba(9,9,9,0.9)_0%,rgba(9,9,9,0.72)_38%,transparent_66%)]"
      />

      <div className="relative z-10 mx-auto max-w-[1320px] px-5 sm:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <div>
            <SectionHeading
              eyebrow="Visual editor"
              title="Point at the thing. Change the thing."
              copy="Edit mode injects a targeting overlay straight into the running preview. Click any element, pick a tool or just type, and Sovereign patches the exact file that element came from — then shows you the diff as a new version."
            />

            <Reveal delay={0.1} className="mt-8">
              <div className="flex flex-wrap gap-1.5">
                {TOOL_CHIPS.map((chip) => (
                  <span
                    key={chip.label}
                    title={chip.prompt}
                    className="rounded-lg border border-white/[0.14] bg-[#161618] px-2.5 py-1.5 text-[11px] font-medium text-foreground-secondary"
                  >
                    {chip.label}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs text-foreground-muted">
                Each chip prefixes your sentence, so you can start from a tool or ignore them
                entirely.
              </p>
            </Reveal>

            <Stagger className="mt-8 space-y-3" step={0.06}>
              {[
                {
                  Icon: MousePointerClick,
                  title: 'Targets map to source',
                  copy: 'A build plugin stamps data-ve-id onto your JSX, so a click resolves to the component that rendered it.',
                },
                {
                  Icon: Sparkles,
                  title: 'Never a black box',
                  copy: 'A visual edit is a normal code edit. It streams into the Code tab and lands in the version timeline.',
                },
              ].map(({ Icon, title, copy }) => (
                <StaggerItem
                  key={title}
                  className="flex gap-4 rounded-2xl border border-border bg-background-subtle/80 p-5 backdrop-blur"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-primary/20 bg-primary/[0.08]">
                    <Icon className="h-4 w-4 text-primary" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{title}</p>
                    <p className="mt-1 text-[13px] leading-6 text-foreground-muted">{copy}</p>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
          </div>

          <Reveal delay={0.12} className="min-w-0">
            <DemoPlayer
              scenes={visualEditorScenes}
              label="Close-up of the visual element editor: an element is targeted, a tool is picked, a change is typed and applied."
              posterSceneId="target"
              surfaceClassName="h-[420px] sm:h-[500px]"
            />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function TemplatesSection() {
  // One rail, duplicated. The keyframe translates by exactly -50%, which is one
  // set of cards, so the second copy lands where the first began and the loop
  // has no visible seam.
  const rail = [...templates, ...templates];

  return (
    <section
      id="templates"
      className="relative scroll-mt-20 overflow-hidden border-y border-white/[0.08] bg-background-subtle/50 py-24 sm:py-32"
    >
      <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <Reveal className="max-w-xl">
            <Eyebrow>Templates</Eyebrow>
            <h2 className="mt-6 text-balance text-[clamp(2.25rem,5vw,3.5rem)] font-extrabold leading-[1.03] tracking-[-0.045em] text-foreground">
              Start from a pattern, not a blank page.
            </h2>
            <p className="mt-5 max-w-lg text-base leading-7 text-foreground-muted">
              Twenty-one briefs with layout, screens and scope already written. Open one and the
              prompt is waiting for you.
            </p>
          </Reveal>

          <Reveal delay={0.08} className="shrink-0">
            <a
              href="/auth/signin"
              className="group inline-flex h-11 items-center gap-2 rounded-full border border-border-strong px-5 text-sm font-medium text-foreground transition-colors hover:border-foreground-muted hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40"
            >
              Browse all templates
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
          </Reveal>
        </div>
      </div>

      {/*
        Full-bleed rail. The track is one duplicated list translated -50% over a
        long period, so the drift is slower than anyone can track. The mask
        dissolves both edges instead of slicing cards, and hovering holds it
        still so a card can be read.
      */}
      <div className="group/rail mt-14">
        <div className="landing-marquee overflow-hidden">
          <ul className="animate-marquee flex w-max gap-4 group-hover/rail:[animation-play-state:paused]">
            {rail.map((template, index) => {
              const art = CATEGORY_ART[template.category as TemplateCategory];
              const guide = templateGuides[template.id]!;
              return (
                <li
                  key={`${template.id}-${index}`}
                  className="w-[230px] shrink-0 overflow-hidden rounded-2xl border border-border bg-background transition-colors duration-300 hover:border-border-strong sm:w-[248px]"
                >
                  <div className="relative aspect-[16/10] overflow-hidden">
                    <TemplateSketch
                      layout={guide.layout}
                      accent={art.accent}
                      surface={art.surface}
                      className="h-full w-full transition-transform duration-500 hover:scale-[1.03]"
                    />
                    <span
                      aria-hidden
                      className="absolute inset-x-8 top-0 h-px"
                      style={{ backgroundColor: art.accent, opacity: 0.55 }}
                    />
                  </div>

                  <div className="p-4">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 truncate text-sm font-semibold text-foreground">
                        {template.name}
                      </p>
                      <span className="shrink-0 rounded border border-border bg-background-muted px-1.5 py-px text-[9px] font-medium text-foreground-muted">
                        template
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-foreground-muted">
                      {template.description}
                    </p>
                    <div className="mt-3.5 flex items-center gap-1.5 border-t border-border pt-3 text-[11px] text-foreground-muted">
                      <Clock className="h-3 w-3 shrink-0" />
                      {template.cloneCount.toLocaleString('en-US')} projects started
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}
