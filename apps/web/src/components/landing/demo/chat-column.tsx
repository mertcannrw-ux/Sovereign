'use client';

import {
  ArrowUp,
  Check,
  FileCode2,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Pencil,
  Search,
  Square,
  Trash2,
  Wrench,
} from 'lucide-react';
import { cn } from '@app-builder/ui/utils';

/* ---------------------------------------------------------------------------
 * Every string in this file is copied from the shipped components:
 *   components/project/chat-panel.tsx   — "Ready to build", "You"/"Assistant",
 *                                         model badge, tool-step summary
 *   components/project/prompt-bar.tsx   — composer placeholder, model trigger,
 *                                         reasoning level, send/stop buttons
 *   components/design-direction-cards.tsx — the 3-concept chooser
 * ------------------------------------------------------------------------- */

export function ChatEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="grid h-11 w-11 place-items-center rounded-xl border border-primary/25 bg-primary/[0.08]">
        <Wrench className="h-5 w-5 text-primary" />
      </span>
      <p className="mt-4 text-sm font-medium text-foreground-secondary">Ready to build</p>
      <p className="mt-1.5 max-w-[26ch] text-xs leading-5 text-foreground-muted">
        Add your API keys in Settings, then describe the app you want to create.
      </p>
    </div>
  );
}

export function UserMessage({ text, time = '09:41' }: { text: string; time?: string }) {
  return (
    <div className="chat-message chat-message--user border-b border-white/[0.04]">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">You</span>
        <span className="text-[10px] text-foreground-muted">{time}</span>
      </div>
      <p className="mt-1.5 text-[13px] leading-6 text-foreground-secondary">{text}</p>
    </div>
  );
}

export function AssistantMessage({
  children,
  model = 'gpt-4o',
  tokens = '1,842 tokens',
  time = '09:41',
}: {
  children: React.ReactNode;
  model?: string;
  tokens?: string;
  time?: string;
}) {
  return (
    <div className="chat-message chat-message--assistant">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-foreground">Assistant</span>
        <span className="rounded border border-border bg-background-muted px-1.5 py-px text-[10px] text-foreground-muted">
          {model}
        </span>
        <span className="ml-auto text-[10px] text-foreground-muted">{tokens}</span>
        <span className="text-[10px] text-foreground-muted">{time}</span>
      </div>
      <div className="mt-1.5 text-[13px] leading-6 text-foreground-secondary">{children}</div>
    </div>
  );
}

const STEP_ICON = {
  write: FileCode2,
  edit: Pencil,
  read: Search,
  delete: Trash2,
  image: ImageIcon,
} as const;

export interface DemoStep {
  kind: keyof typeof STEP_ICON;
  path: string;
  ms: number;
}

/** `ToolStepsDisplay` — collapsed summary plus the expanded per-file rows. */
export function ToolSteps({
  steps,
  changes,
  reads,
  expanded = true,
  activeIndex = -1,
}: {
  steps: DemoStep[];
  changes: number;
  reads: number;
  expanded?: boolean;
  activeIndex?: number;
}) {
  return (
    <div className="mx-3 my-2 overflow-hidden rounded-lg border border-border bg-background-subtle">
      <div className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-foreground-secondary">
        <span className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          {changes} file changes, {reads} file reads
        </span>
        <span className="text-[10px] text-foreground-muted">Show reasoning</span>
      </div>
      {expanded && (
        <ul className="space-y-0.5 border-t border-border px-2 py-1.5">
          {steps.map((step, index) => {
            const Icon = STEP_ICON[step.kind];
            const active = index === activeIndex;
            return (
              <li
                key={`${step.kind}-${step.path}`}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
                  active ? 'bg-background-muted' : 'bg-background/50',
                )}
              >
                <Icon className={cn('h-3.5 w-3.5 shrink-0', active && 'text-primary')} />
                <span className="truncate font-mono text-[11px] text-foreground-secondary">
                  {step.path}
                </span>
                <span className="ml-auto shrink-0 text-[10px] text-foreground-muted">
                  {step.ms}ms
                </span>
                {active ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
                ) : (
                  <Check className="h-3 w-3 shrink-0 text-success" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** `components/design-direction-cards.tsx` — the 3-concept chooser. */
export function DesignDirectionPicker({ revealed }: { revealed: number }) {
  const concepts = [
    { name: 'Warm editorial', tone: 'bg-[#F2EEE4]', ink: 'bg-[#2A2721]' },
    { name: 'Cool technical', tone: 'bg-[#E7EDF5]', ink: 'bg-[#1E2A38]' },
    { name: 'High contrast', tone: 'bg-[#161616]', ink: 'bg-[#B8FF5A]' },
  ];
  return (
    <div className="mx-3 my-3 rounded-xl border border-border bg-background-subtle p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-foreground">Choose a Visual Direction</p>
        <span className="rounded-full border border-border bg-background-muted px-2 py-0.5 text-[10px] text-foreground-muted">
          3 Concepts
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {concepts.map((concept, index) => (
          <div
            key={concept.name}
            className={cn(
              'overflow-hidden rounded-lg border transition-all duration-500',
              index < revealed ? 'border-border opacity-100' : 'border-transparent opacity-0',
            )}
          >
            <div className={cn('relative h-14 p-2', concept.tone)}>
              <div className={cn('h-1 w-8 rounded-full', concept.ink)} />
              <div className="mt-1.5 h-1 w-12 rounded-full bg-black/15" />
              <div className="mt-1.5 h-1 w-10 rounded-full bg-black/15" />
              <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1 text-[8px] font-semibold text-white">
                Option {index + 1}
              </span>
            </div>
            <p className="truncate bg-background px-1.5 py-1 text-[9px] text-foreground-muted">
              {concept.name}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-2.5 text-center text-[10px] text-foreground-muted">
        Let Sovereign choose default
      </p>
    </div>
  );
}

export function PromptBar({
  text,
  sending = false,
  targeting = false,
  model = 'gpt-4o',
  effort = 'Auto',
  attachment,
  className,
}: {
  /** Characters of the prompt already "typed" into the composer. */
  text?: string;
  sending?: boolean;
  /** The element target banner the real composer shows above the textarea. */
  targeting?: boolean;
  model?: string | null;
  effort?: string;
  attachment?: string;
  className?: string;
}) {
  return (
    <div className={cn('shrink-0 border-t border-border bg-background p-3', className)}>
      {targeting && (
        <div className="mb-2 flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/[0.08] px-2 py-1 text-[11px] text-primary">
          <span className="font-mono">Editing</span>
          <span className="truncate font-mono text-primary/80">section.hero</span>
        </div>
      )}
      <div className="rounded-xl border border-border bg-background-muted p-2 transition-colors focus-within:border-border-focus">
        {attachment && (
          <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-1.5 py-1 text-[10px] text-foreground-secondary">
            <ImageIcon className="h-3 w-3" />
            {attachment}
          </div>
        )}
        <div className="min-h-[44px] px-2 text-[13px] leading-6 text-foreground">
          {text || (
            <span className="text-foreground-muted">
              Describe what you want to build or change…
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center justify-between border-t border-white/[0.06] pt-2">
          <div className="flex items-center gap-1.5">
            <span
              title="Append images or files"
              className="grid h-7 w-7 place-items-center rounded-md text-foreground-muted"
            >
              <Paperclip className="h-3.5 w-3.5" />
            </span>
            <span className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] text-foreground-secondary">
              {model ?? 'Select Model'}
              <span className="text-foreground-muted/50">·</span>
              {effort}
            </span>
          </div>
          {sending ? (
            <span
              aria-label="Stop agent"
              className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground"
            >
              <Square className="h-3 w-3 fill-current" />
            </span>
          ) : (
            <span
              aria-label="Send message"
              className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground"
            >
              <ArrowUp className="h-4 w-4" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
