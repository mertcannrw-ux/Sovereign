'use client';

import {
  ArrowRight,
  Boxes,
  Cloud,
  Database,
  GitBranch,
  History,
  Rocket,
  Users,
} from 'lucide-react';
import { SectionHeading, Stagger, StaggerItem } from '../primitives';
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
 * The product grid. Every card embeds a live rendering of shipped UI rather
 * than an illustration of it — the tool-step list, the version strip, the
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
  { name: 'deployments', copy: 'Vercel deploy + status polling' },
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
    number: '01',
    title: 'Connect your model',
    copy: 'Paste a key for any supported provider. It is encrypted with AES-256-GCM and validated directly with that provider.',
  },
  {
    number: '02',
    title: 'Describe the outcome',
    copy: 'One sentence or a full brief. The agent reads your files, thinks, and offers three visual directions before it writes a line.',
  },
  {
    number: '03',
    title: 'Shape it visually',
    copy: 'Click any element in the live preview and change it in plain English. Every edit is a normal code edit, saved as a version.',
  },
  {
    number: '04',
    title: 'Ship without lock-in',
    copy: 'Read the TypeScript in the Code tab, export the repo, or deploy. Nothing here is a rendering you cannot take with you.',
  },
];

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <StaggerItem
      className={`group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-background-subtle p-7 transition-colors duration-300 hover:border-border-strong sm:p-8 ${className}`}
    >
      {children}
    </StaggerItem>
  );
}

function CardHead({
  icon: Icon,
  title,
  copy,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  copy: string;
}) {
  return (
    <div className="relative z-10 max-w-md pb-8">
      <span className="grid h-10 w-10 place-items-center rounded-xl border border-primary/20 bg-primary/[0.08]">
        <Icon className="h-5 w-5 text-primary" />
      </span>
      <h3 className="mt-6 text-2xl font-bold tracking-[-0.035em] text-foreground">{title}</h3>
      <p className="mt-3 text-sm leading-6 text-foreground-muted">{copy}</p>
    </div>
  );
}

export function ProductSection() {
  return (
    <section id="product" className="relative scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
        <SectionHeading
          eyebrow="One connected workspace"
          title="A faster path from intent to interface."
          copy="Conversation, live preview, code, data and infrastructure share one project. Nothing is a mockup you have to throw away — every change lands in the same app you are shipping."
        />

        <Stagger className="mt-14 grid gap-4 lg:grid-cols-12">
          <Card className="lg:col-span-7">
            <CardHead
              icon={Boxes}
              title="The agent writes in the open."
              copy="You see every file it reads, creates and edits — with paths, timings and the model that did the work. No progress bar standing in for a transcript."
            />
            <div className="relative z-10 mt-auto overflow-hidden rounded-2xl border border-border bg-background">
              <ToolSteps steps={STEPS} changes={12} reads={4} activeIndex={-1} />
              <PromptBar model="gpt-4o" effort="Auto" />
            </div>
          </Card>

          <Card className="lg:col-span-5">
            <CardHead
              icon={History}
              title="Every run is a version."
              copy="Snapshots land as the agent writes. Open any of them, read the diff, and restore the workspace in one click."
            />
            <div className="relative z-10 mt-auto overflow-hidden rounded-2xl border border-border bg-background">
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
                The preview shows your current files. Use Restore v4 in the version bar to apply
                this snapshot.
              </p>
              <AssistantMessage model="gpt-4o" tokens="—">
                Restoring rewrites the workspace to that snapshot. Nothing after it is lost — the
                timeline keeps both.
              </AssistantMessage>
            </div>
          </Card>

          <Card className="lg:col-span-7">
            <CardHead
              icon={GitBranch}
              title="The same project, as code."
              copy="One tab flips from the running app to the TypeScript behind it. Read it, copy it, take it — the Code pane is not a preview of the source, it is the source."
            />
            <div className="relative z-10 mt-auto h-[300px] overflow-hidden rounded-2xl border border-border">
              <CodePaneView files={CODE_FILES} active="src/App.tsx" />
            </div>
          </Card>

          <Card className="lg:col-span-5">
            <CardHead
              icon={Cloud}
              title="A direction before a single file."
              copy="Sovereign proposes three rendered concepts and lets you pick — or take its recommendation and keep moving."
            />
            <div className="relative z-10 mt-auto overflow-hidden rounded-2xl border border-border bg-background p-2">
              <DesignDirectionPicker revealed={3} />
            </div>
          </Card>

          <Card className="lg:col-span-4">
            <CardHead
              icon={Database}
              title="Backend included."
              copy="Server functions, tables, app users and assets are part of the project, not a separate service to wire up later."
            />
            <ul className="relative z-10 mt-auto space-y-1.5">
              {ROUTERS.map((router) => (
                <li
                  key={router.name}
                  className="flex items-baseline gap-3 rounded-lg border border-border bg-background px-3 py-2"
                >
                  <span className="font-mono text-[11px] text-primary">{router.name}</span>
                  <span className="truncate text-[11px] text-foreground-muted">{router.copy}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="lg:col-span-4">
            <CardHead
              icon={Users}
              title="Built for more than one."
              copy="Organizations, invites and per-project access. The agent only writes where your role allows it."
            />
            <div className="relative z-10 mt-auto space-y-4">
              {ROLES.map((role) => (
                <div key={role.scope}>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground-muted">
                    {role.scope}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {role.values.map((value) => (
                      <span
                        key={value}
                        className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[10px] text-foreground-secondary"
                      >
                        {value}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="lg:col-span-4">
            <CardHead
              icon={Rocket}
              title="Leave whenever you want."
              copy="Sync to GitHub, export the repo, or deploy. Sovereign is a workspace, not a lease."
            />
            <ul className="relative z-10 mt-auto space-y-2.5">
              {EXPORTS.map(({ Icon, label, copy }) => (
                <li
                  key={label}
                  className="flex gap-3 rounded-xl border border-border bg-background p-3.5"
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">{label}</p>
                    <p className="mt-0.5 text-[11px] leading-5 text-foreground-muted">{copy}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </Stagger>
      </div>
    </section>
  );
}

export function WorkflowSection() {
  return (
    <section
      id="workflow"
      className="relative scroll-mt-20 border-y border-white/[0.08] bg-background-subtle/50 py-24 sm:py-32"
    >
      <div className="mx-auto max-w-[1320px] px-5 sm:px-8">
        <SectionHeading
          eyebrow="How it works"
          title="Make software the way you think."
          copy="Start in English, end up in the source. Move between natural language, visual editing and code without losing context."
        />

        <Stagger className="mt-14 border-t border-border">
          {WORKFLOW.map((step) => (
            <StaggerItem
              key={step.number}
              className="group grid gap-3 border-b border-border py-7 sm:grid-cols-[72px_1fr_1fr_32px] sm:items-center sm:gap-6 sm:py-9"
            >
              <span className="font-mono text-xs text-primary">{step.number}</span>
              <h3 className="text-xl font-semibold tracking-[-0.03em] text-foreground sm:text-2xl">
                {step.title}
              </h3>
              <p className="max-w-xl text-sm leading-6 text-foreground-muted">{step.copy}</p>
              <ArrowRight className="hidden h-5 w-5 text-foreground-muted/40 transition-all duration-300 group-hover:translate-x-1 group-hover:text-primary sm:block" />
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}
