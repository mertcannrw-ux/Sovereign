import Link from 'next/link';
import { ArrowRight, MousePointerClick, Sparkles } from 'lucide-react';
import { TemplateSketch } from '@/app/dashboard/templates/template-sketch';
import { templateCategories, templateGuides, templates } from '@/data/templates';
import { Section, SectionHeading } from '../primitives';
import { VisualEditorFilm } from '../demo/films';

/* ---------------------------------------------------------------------------
 * The visual editor close-up, and the template catalog.
 *
 * The catalog renders the same `TemplateSketch` wireframes the signed-in
 * Templates page draws, but in monochrome: on the marketing page colour is
 * reserved for actions. The rows are the real records from `data/templates.ts`.
 * ------------------------------------------------------------------------- */

const TOOL_CHIPS = ['Text', 'Color', 'Typography', 'Spacing', 'Layout', 'Border', 'Effects'];

const POINTS = [
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
];

/** One template per category, in catalog order. */
const SHOWCASE = templateCategories
  .filter((category) => category !== 'All')
  .map((category) => templates.find((template) => template.category === category))
  .filter((template) => template !== undefined);

export function VisualEditorSection() {
  return (
    <Section id="editor">
      <div className="grid items-start gap-14 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
        <div>
          <SectionHeading
            index="02"
            eyebrow="Visual editor"
            title="Point at the thing. Change the thing."
            copy="Edit mode injects a targeting overlay straight into the running preview. Click any element, pick a tool or just type, and Sovereign patches the exact file that element came from, then shows you the diff as a new version."
          />

          <div className="mt-8">
            <ul className="flex flex-wrap gap-1.5" aria-label="Edit tools">
              {TOOL_CHIPS.map((chip) => (
                <li
                  key={chip}
                  className="rounded border border-border px-2 py-1 font-mono text-[11px] text-foreground-secondary"
                >
                  {chip}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs leading-5 text-foreground-muted">
              Each tool prefixes your sentence, so you can start from one or ignore them entirely.
            </p>
          </div>

          <ul className="mt-10 divide-y divide-border border-y border-border">
            {POINTS.map(({ Icon, title, copy }) => (
              <li key={title} className="flex gap-4 py-5">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-foreground-secondary" />
                <div>
                  <p className="text-sm font-medium text-foreground">{title}</p>
                  <p className="mt-1 text-[13px] leading-6 text-foreground-muted">{copy}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-0">
          <VisualEditorFilm />
        </div>
      </div>
    </Section>
  );
}

export function TemplatesSection() {
  return (
    <Section id="templates">
      <SectionHeading
        index="04"
        eyebrow="Templates"
        title="Start from a pattern, not a blank page."
        copy={`${templates.length} briefs with layout, screens and scope already written. Open one and the prompt is waiting for you.`}
      />

      <ul className="mt-14 grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {SHOWCASE.map((template) => (
          <li key={template.id} className="flex flex-col bg-background">
            <div className="border-b border-border bg-background-subtle p-4">
              <TemplateSketch
                layout={templateGuides[template.id]!.layout}
                accent="var(--foreground-secondary)"
                surface="var(--background-subtle)"
                className="aspect-[16/10] w-full"
              />
            </div>
            <div className="flex flex-1 flex-col p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-foreground-muted">
                {template.category}
              </p>
              <h3 className="mt-2 text-sm font-semibold text-foreground">{template.name}</h3>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-foreground-muted">
                {template.description}
              </p>
            </div>
          </li>
        ))}
        <li className="bg-background">
          <Link
            href="/auth/signin"
            className="group flex h-full min-h-[200px] flex-col justify-between p-5 transition-colors hover:bg-background-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus/40"
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-foreground-muted">
              Catalog
            </span>
            <span className="flex items-center justify-between text-sm font-medium text-foreground">
              Browse all {templates.length} templates
              <ArrowRight className="h-4 w-4 text-foreground-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </span>
          </Link>
        </li>
      </ul>
    </Section>
  );
}
