import type { ComponentType, ReactNode } from 'react';
import { Boxes, Cloud, Database, GitBranch, History, Rocket, Users } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';
import { Section, SectionHeading } from '../primitives';
import { VersionStrip } from '../demo/app-header';
import {
  AssistantMessage,
  DesignDirectionPicker,
  PromptBar,
  ToolSteps,
  UserMessage,
  type DemoStep,
} from '../demo/chat-column';
import { CodePaneView } from '../demo/workspace-panes';

/**
 * The product grid. Every cell embeds a live rendering of shipped UI rather
 * than an illustration of it: the tool-step list, the version strip, the
 * code pane and the direction picker are the same components the app uses.
 */

const STEPS: DemoStep[] = [
  { kind: 'read', path: 'src/lib/data.ts', ms: 41 },
  { kind: 'write', path: 'src/components/MetricCard.tsx', ms: 187 },
  { kind: 'write', path: 'src/App.tsx', ms: 263 },
  { kind: 'edit', path: 'src/index.css', ms: 74 },
];

const CODE_FILES = ['src/App.tsx', 'src/main.tsx', 'src/index.css', 'src/lib/data.ts'];

/** Server routers that ship in `lib/trpc/routers/`. */
const ROUTERS = [
  { name: 'functions', copy: 'server functions per project' },
  { name: 'database', copy: 'tables, schema, ad-hoc queries' },
  { name: 'appAuth', copy: 'app users, sessions, config' },
  { name: 'assets', copy: 'project media with magic-byte checks' },
  { name: 'deployments', copy: 'Vercel deploy and status polling' },
  { name: 'github', copy: 'installation, repositories, sync' },
];

const ROLES = [
  { scope: 'Project', values: ['OWNER', 'EDITOR', 'VIEWER'] },
  { scope: 'Organization', values: ['OWNER', 'ADMIN', 'MEMBER'] },
];

const EXPORTS = [
  { Icon: GitBranch, label: 'GitHub sync', copy: 'Connect an installation and push the project.' },
  { Icon: Boxes, label: 'Full export', copy: 'Take the whole TypeScript codebase with you.' },
  { Icon: Rocket, label: 'Deploy', copy: 'Ship to Vercel when credentials are configured.' },
];

const WORKFLOW = [
  {
    title: 'Connect your model',
    copy: 'Paste a key for any supported provider. It is encrypted with AES-256-GCM and validated directly with that provider.',
  },
  {
    title: 'Describe the outcome',
    copy: 'One sentence or a full brief. The agent reads your files, thinks, and offers three visual directions before it writes a line.',
  },
  {
    title: 'Shape it visually',
    copy: 'Click any element in the live preview and change it in plain English. Every edit is a normal code edit, saved as a version.',
  },
  {
    title: 'Ship without lock-in',
    copy: 'Read the TypeScript in the Code tab, export the repo, or deploy. Nothing here is a rendering you cannot take with you.',
  },
];

function Cell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex flex-col bg-background p-6 sm:p-8', className)}>{children}</div>;
}

function CellHead({
  icon: Icon,
  title,
  copy,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  copy: string;
}) {
  return (
    <div className="max-w-md pb-8">
      <Icon className="h-4 w-4 text-foreground-secondary" />
      <h3 className="mt-5 text-lg font-semibold tracking-[-0.02em] text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-foreground-muted">{copy}</p>
    </div>
  );
}

/** Frame for an embedded piece of product UI inside a cell. */
const inset = 'mt-auto overflow-hidden rounded-lg border border-border bg-background';

export function ProductSection() {
  return (
    <Section id="product">
      <SectionHeading
        index="01"
        eyebrow="Workspace"
        title="A faster path from intent to interface."
        copy="Conversation, live preview, code, data and infrastructure share one project. Nothing is a mockup you have to throw away. Every change lands in the same app you are shipping."
      />

      <div className="mt-14 grid gap-px border border-border bg-border lg:grid-cols-12">
        <Cell className="lg:col-span-7">
          <CellHead
            icon={Boxes}
            title="The agent writes in the open."
            copy="You see every file it reads, creates and edits, with paths, timings and the model that did the work. No progress bar standing in for a transcript."
          />
          <div className={inset}>
            <ToolSteps steps={STEPS} changes={12} reads={4} activeIndex={-1} />
            <PromptBar model="Opus 5.5" effort="Auto" />
          </div>
        </Cell>

        <Cell className="lg:col-span-5">
          <CellHead
            icon={History}
            title="Every run is a version."
            copy="Snapshots land as the agent writes. Open any of them, read the diff, and restore the workspace in one click."
          />
          <div className={inset}>
            <UserMessage text="Make the chart area taller and use the accent colour." />
            <VersionStrip
              versions={[
                { n: 1, files: 2 },
                { n: 2, files: 4 },
                { n: 3, files: 9 },
                { n: 4, files: 3, restore: true },
                { n: 5, files: 2 },
              ]}
              current={5}
              selected={4}
              showRestoreButton
            />
            <p className="px-4 py-3 text-[11px] leading-5 text-warning">
              The preview shows your current files. Use Restore v4 in the version bar to apply this
              snapshot.
            </p>
            <AssistantMessage model="Opus 5.5" tokens="0 tokens">
              Restoring rewrites the workspace to that snapshot. Nothing after it is lost. The
              timeline keeps both.
            </AssistantMessage>
          </div>
        </Cell>

        <Cell className="lg:col-span-7">
          <CellHead
            icon={GitBranch}
            title="The same project, as code."
            copy="One tab flips from the running app to the TypeScript behind it. Read it, copy it, take it. The Code pane is not a preview of the source, it is the source."
          />
          <div className={cn(inset, 'h-[300px]')}>
            <CodePaneView files={CODE_FILES} active="src/App.tsx" />
          </div>
        </Cell>

        <Cell className="lg:col-span-5">
          <CellHead
            icon={Cloud}
            title="A direction before a single file."
            copy="Sovereign proposes three rendered concepts and lets you pick, or take its recommendation and keep moving."
          />
          <div className={cn(inset, 'p-2')}>
            <DesignDirectionPicker revealed={3} />
          </div>
        </Cell>

        <Cell className="lg:col-span-4">
          <CellHead
            icon={Database}
            title="Backend included."
            copy="Server functions, tables, app users and assets are part of the project, not a separate service to wire up later."
          />
          <ul className="mt-auto divide-y divide-border border-y border-border">
            {ROUTERS.map((router) => (
              <li key={router.name} className="flex items-baseline gap-3 py-2">
                <span className="w-24 shrink-0 font-mono text-[11px] text-foreground">
                  {router.name}
                </span>
                <span className="truncate text-xs text-foreground-muted">{router.copy}</span>
              </li>
            ))}
          </ul>
        </Cell>

        <Cell className="lg:col-span-4">
          <CellHead
            icon={Users}
            title="Built for more than one."
            copy="Organizations, invites and per-project access. The agent only writes where your role allows it."
          />
          <div className="mt-auto space-y-4">
            {ROLES.map((role) => (
              <div key={role.scope}>
                <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-foreground-muted">
                  {role.scope}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {role.values.map((value) => (
                    <span
                      key={value}
                      className="rounded border border-border px-2 py-1 font-mono text-[11px] text-foreground-secondary"
                    >
                      {value}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Cell>

        <Cell className="lg:col-span-4">
          <CellHead
            icon={Rocket}
            title="Leave whenever you want."
            copy="Sync to GitHub, export the repo, or deploy. Sovereign is a workspace, not a lease."
          />
          <ul className="mt-auto divide-y divide-border border-y border-border">
            {EXPORTS.map(({ Icon, label, copy }) => (
              <li key={label} className="flex gap-3 py-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" />
                <div>
                  <p className="text-[13px] font-medium text-foreground">{label}</p>
                  <p className="mt-0.5 text-xs leading-5 text-foreground-muted">{copy}</p>
                </div>
              </li>
            ))}
          </ul>
        </Cell>
      </div>
    </Section>
  );
}

export function WorkflowSection() {
  return (
    <Section id="workflow">
      <SectionHeading
        index="03"
        eyebrow="How it works"
        title="Make software the way you think."
        copy="Start in English, end up in the source. Move between natural language, visual editing and code without losing context."
      />

      <ol className="mt-14 grid gap-px border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
        {WORKFLOW.map((step, i) => (
          <li key={step.title} className="flex flex-col bg-background p-6 sm:p-8">
            <span className="font-mono text-[11px] text-foreground-muted">
              {String(i + 1).padStart(2, '0')}
            </span>
            <h3 className="mt-10 text-lg font-semibold tracking-[-0.02em] text-foreground">
              {step.title}
            </h3>
            <p className="mt-2 text-sm leading-6 text-foreground-muted">{step.copy}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
