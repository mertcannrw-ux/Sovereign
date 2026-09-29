'use client';

import { History } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';
import { AppSidebar } from './app-sidebar';
import { EditorHeader, VersionStrip, type DemoVersion } from './app-header';
import {
  AssistantMessage,
  ChatEmptyState,
  DesignDirectionPicker,
  PromptBar,
  ToolSteps,
  UserMessage,
  type DemoStep,
} from './chat-column';
import { stage, type DemoScene } from './demo-player';
import {
  CodePaneView,
  DemoCursor,
  ElementTarget,
  PaneTabs,
  PreviewSurface,
  VisualEditorOverlay,
} from './workspace-panes';

/* ---------------------------------------------------------------------------
 * The hero film: one prompt, one app, seven beats. Every string the viewer
 * reads is a string the running product actually renders.
 * ------------------------------------------------------------------------- */

const PROJECT = 'Analytics Dashboard';

const PROMPT =
  'Build a light, editorial analytics dashboard for a solar energy company. Use warm neutrals, a large headline, and generous spacing.';

const FILES = [
  'index.html',
  'package.json',
  'vite.config.ts',
  'src/main.tsx',
  'src/App.tsx',
  'src/index.css',
  'src/lib/data.ts',
  'src/components/MetricCard.tsx',
  'src/components/OutputChart.tsx',
];

const STEPS: DemoStep[] = [
  { kind: 'read', path: 'src/lib/data.ts', ms: 41 },
  { kind: 'write', path: 'index.html', ms: 118 },
  { kind: 'write', path: 'src/main.tsx', ms: 96 },
  { kind: 'write', path: 'src/index.css', ms: 143 },
  { kind: 'write', path: 'src/components/MetricCard.tsx', ms: 187 },
  { kind: 'write', path: 'src/components/OutputChart.tsx', ms: 204 },
  { kind: 'write', path: 'src/App.tsx', ms: 263 },
  { kind: 'edit', path: 'src/index.css', ms: 74 },
];

const VERSIONS: DemoVersion[] = [
  { n: 1, files: 2 },
  { n: 2, files: 4 },
  { n: 3, files: 9 },
  { n: 4, files: 3, restore: true },
  { n: 5, files: 2 },
  { n: 6, files: 5 },
  { n: 7, files: 3 },
];

const HERO_SELECTOR = 'body > main > section:nth-of-type(1)';
const HERO_EDIT = 'Make the hero near-black with a lime accent';
/** What the overlay actually posts: the `Color` chip prefix plus the sentence. */
const HERO_WIRE_PROMPT = `Change the colors: ${HERO_EDIT}`;

/** Full-bleed editor window. Each scene repaints the whole thing. */
function Window({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full bg-background">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}

/**
 * The shipped split: chat on the left at 38%, workspace on the right. Below
 * `md` the real app shows a single pane with a View Preview / Back to chat
 * toggle, so the demo does the same — a 38% column on a phone is unreadable.
 */
function Split({
  chat,
  work,
  mobile = 'work',
}: {
  chat: React.ReactNode;
  work: React.ReactNode;
  mobile?: 'chat' | 'work';
}) {
  return (
    <div className="flex min-h-0 flex-1">
      <div
        className={cn(
          'min-w-0 flex-col border-r border-border bg-background md:flex md:w-[38%]',
          mobile === 'chat' ? 'flex w-full' : 'hidden',
        )}
      >
        {chat}
      </div>
      <div
        className={cn(
          'min-w-0 flex-1 flex-col bg-background md:flex',
          mobile === 'work' ? 'flex w-full' : 'hidden',
        )}
      >
        {work}
      </div>
    </div>
  );
}

function Workbench({
  tab,
  editMode = false,
  banner,
  children,
}: {
  tab: 'preview' | 'code';
  editMode?: boolean;
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <>
      <PaneTabs tab={tab} editMode={editMode} />
      {banner}
      <div className="min-h-0 flex-1">{children}</div>
    </>
  );
}

export const buildScenes: DemoScene[] = [
  {
    id: 'brief',
    label: 'Brief',
    duration: 5,
    caption: 'A fresh project — the composer is ready for its first sentence.',
    render: ({ p }) => (
      <Window>
        <EditorHeader projectName={PROJECT} />
        <VersionStrip versions={[{ n: 1, files: 0 }]} current={1} />
        <Split
          mobile="chat"
          chat={
            <>
              <div className="min-h-0 flex-1 overflow-hidden">
                {p < 0.12 ? <ChatEmptyState /> : null}
              </div>
              <PromptBar
                text={PROMPT.slice(0, Math.round(stage(p, 0.12, 0.86) * PROMPT.length))}
                sending={p > 0.88}
                model={null}
              />
            </>
          }
          work={
            <Workbench tab="preview">
              <PreviewSurface booted={false} bootProgress={p} editMode={false} restyled={false} />
            </Workbench>
          }
        />
      </Window>
    ),
  },
  {
    id: 'plan',
    label: 'Plan',
    duration: 5,
    caption: 'The agent reads the brief, thinks, and offers three visual directions.',
    render: ({ p }) => (
      <Window>
        <EditorHeader projectName={PROJECT} />
        <VersionStrip versions={VERSIONS.slice(0, 1)} current={1} />
        <Split
          mobile="chat"
          chat={
            <>
              <div className="min-h-0 flex-1 overflow-hidden">
                <UserMessage text={PROMPT} />
                {p > 0.2 && (
                  <AssistantMessage model="gpt-4o" tokens="412 tokens">
                    <span className="flex items-center gap-1.5 text-foreground-muted">
                      <span className="animate-shimmer h-1.5 w-1.5 rounded-full bg-primary" />
                      Analyzing the request…
                    </span>
                  </AssistantMessage>
                )}
                {p > 0.35 && (
                  <DesignDirectionPicker revealed={Math.round(stage(p, 0.35, 0.7) * 3)} />
                )}
                {p > 0.78 && (
                  <AssistantMessage model="gpt-4o" tokens="1,106 tokens">
                    Going with <span className="text-primary">Warm editorial</span>. Writing the
                    shell and the data layer first.
                  </AssistantMessage>
                )}
              </div>
              <PromptBar sending model="gpt-4o" />
            </>
          }
          work={
            <Workbench tab="preview">
              <PreviewSurface
                booted={false}
                bootProgress={Math.max(0.05, stage(p, 0.3, 1))}
                editMode={false}
                restyled={false}
              />
            </Workbench>
          }
        />
      </Window>
    ),
  },
  {
    id: 'build',
    label: 'Build',
    duration: 6,
    caption: 'Files stream in one by one — every write, edit and read lands in front of you.',
    render: ({ p }) => {
      const visibleSteps = Math.max(1, Math.ceil(stage(p, 0.12, 0.82) * STEPS.length));
      return (
        <Window>
          <EditorHeader projectName={PROJECT} />
          <VersionStrip versions={VERSIONS.slice(0, p > 0.85 ? 2 : 1)} current={p > 0.85 ? 2 : 1} />
          <Split
            mobile="work"
            chat={
              <>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <UserMessage text={PROMPT} />
                  {p > 0.08 && (
                    <ToolSteps
                      steps={STEPS.slice(0, visibleSteps)}
                      changes={12}
                      reads={4}
                      activeIndex={visibleSteps - 1}
                    />
                  )}
                  {p > 0.9 && (
                    <AssistantMessage model="gpt-4o" tokens="1,842 tokens">
                      Twelve files written. Booting the preview sandbox now.
                    </AssistantMessage>
                  )}
                </div>
                <PromptBar text={PROMPT} sending model="gpt-4o" />
              </>
            }
            work={
              <Workbench tab="preview">
                <PreviewSurface
                  booted={p > 0.62}
                  bootProgress={stage(p, 0.35, 0.68)}
                  editMode={false}
                  restyled={false}
                />
              </Workbench>
            }
          />
        </Window>
      );
    },
  },
  {
    id: 'preview',
    label: 'Preview',
    duration: 4.5,
    caption: 'The generated app runs in a sandboxed browser runtime — Preview or Code, one click.',
    render: ({ p }) => (
      <Window>
        <EditorHeader projectName={PROJECT} />
        <VersionStrip versions={VERSIONS.slice(0, 2)} current={2} />
        <Split
          mobile="work"
          chat={
            <>
              <div className="min-h-0 flex-1 overflow-hidden">
                <UserMessage text={PROMPT} />
                <ToolSteps
                  steps={STEPS}
                  changes={12}
                  reads={4}
                  expanded={p < 0.4}
                  activeIndex={-1}
                />
                {p > 0.45 && (
                  <AssistantMessage model="gpt-4o" tokens="1,842 tokens">
                    It is live. Try the visual editor — click any element and change it in plain
                    English.
                  </AssistantMessage>
                )}
              </div>
              <PromptBar model="gpt-4o" effort="Auto" />
            </>
          }
          work={
            <Workbench tab="preview">
              <PreviewSurface booted editMode={false} restyled={false} bootProgress={1} />
            </Workbench>
          }
        />
      </Window>
    ),
  },
  {
    id: 'visual',
    label: 'Visual edit',
    duration: 8.5,
    caption: 'Click one element, describe the change, and the real app updates behind it.',
    render: ({ p }) => {
      const hovering = p > 0.14 && p < 0.28;
      const selected = p >= 0.28 && p < 0.9;
      const overlayOpen = p >= 0.34 && p < 0.9;
      const sent = p >= 0.66;
      const restyled = p > 0.72;
      const editMode = p < 0.9;

      return (
        <Window>
          <EditorHeader projectName={PROJECT} />
          <VersionStrip versions={VERSIONS.slice(0, restyled ? 4 : 3)} current={restyled ? 4 : 3} />
          <Split
            mobile="work"
            chat={
              <>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <UserMessage text={PROMPT} />
                  <ToolSteps steps={STEPS} changes={12} reads={4} activeIndex={-1} />
                  {sent && <UserMessage text={HERO_WIRE_PROMPT} />}
                  {restyled && (
                    <AssistantMessage model="gpt-4o" tokens="268 tokens">
                      Updated <span className="font-mono text-primary">src/index.css</span> —
                      palette, headline colour and accent fill are now dark and lime. Saved as v4.
                    </AssistantMessage>
                  )}
                </div>
                <PromptBar sending={!sent && overlayOpen} targeting={selected} model="gpt-4o" />
              </>
            }
            work={
              <Workbench tab="preview" editMode={editMode}>
                <PreviewSurface booted editMode={editMode} restyled={restyled} bootProgress={1}>
                  <ElementTarget
                    state={selected ? 'selected' : hovering ? 'hover' : 'none'}
                    className="left-[3%] right-[3%] top-[19%] h-[36%]"
                  />
                  {overlayOpen && (
                    <VisualEditorOverlay
                      selector={HERO_SELECTOR}
                      toolIndex={p > 0.4 ? 1 : -1}
                      typed={HERO_EDIT.slice(
                        0,
                        Math.round(stage(p, 0.42, 0.66) * HERO_EDIT.length),
                      )}
                      sent={sent}
                      className="top-[58%]"
                    />
                  )}
                  {p < 0.34 && (
                    <DemoCursor x={34} y={p < 0.14 ? 62 : 40} label={hovering ? 'Hero' : 'You'} />
                  )}
                </PreviewSurface>
              </Workbench>
            }
          />
        </Window>
      );
    },
  },
  {
    id: 'code',
    label: 'Code',
    duration: 4,
    caption: 'The Code tab is the same project as real TypeScript — never a black box.',
    render: ({ p }) => (
      <Window>
        <EditorHeader projectName={PROJECT} />
        <VersionStrip versions={VERSIONS.slice(0, 4)} current={4} />
        <Split
          mobile="work"
          chat={
            <>
              <div className="min-h-0 flex-1 overflow-hidden">
                <UserMessage text={PROMPT} />
                <ToolSteps steps={STEPS} changes={12} reads={4} activeIndex={-1} />
              </div>
              <PromptBar model="gpt-4o" />
            </>
          }
          work={
            <Workbench tab="code">
              <CodePaneView files={FILES} active="src/App.tsx" streaming={p < 0.6} />
            </Workbench>
          }
        />
      </Window>
    ),
  },
  {
    id: 'history',
    label: 'History',
    duration: 4.5,
    caption: 'Every run is a version. Roll back to any snapshot in one click.',
    render: ({ p }) => {
      const selected = p > 0.25 && p < 0.8 ? 5 : 7;
      const viewingOlder = selected !== 7;
      return (
        <Window>
          <EditorHeader projectName={PROJECT} />
          <VersionStrip
            versions={VERSIONS}
            current={7}
            selected={selected}
            showRestoreButton={viewingOlder}
          />
          <Split
            mobile="work"
            chat={
              <>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <UserMessage text={PROMPT} />
                  <ToolSteps steps={STEPS} changes={12} reads={4} activeIndex={-1} />
                  {viewingOlder && (
                    <AssistantMessage model="gpt-4o" tokens="—">
                      Viewing version {selected}. Restoring brings the workspace back to this exact
                      snapshot.
                    </AssistantMessage>
                  )}
                </div>
                <PromptBar model="gpt-4o" />
              </>
            }
            work={
              <Workbench
                tab="preview"
                banner={
                  viewingOlder ? (
                    <div className="flex items-center gap-2 border-b border-warning/30 bg-warning-light px-4 py-1.5 text-[11px] leading-4 text-warning">
                      <History className="h-3.5 w-3.5 shrink-0" aria-hidden />
                      <p>
                        The preview shows your current files. Use Restore v{selected} in the version
                        bar to apply this snapshot.
                      </p>
                    </div>
                  ) : null
                }
              >
                <PreviewSurface booted editMode={false} restyled={p > 0.82} bootProgress={1} />
              </Workbench>
            }
          />
        </Window>
      );
    },
  },
];
