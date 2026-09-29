'use client';

import { KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { DemoCursor, ElementTarget, VisualEditorOverlay } from './workspace-panes';
import { GeneratedApp } from './generated-app';
import { SettingsWindow } from './settings-window';
import { stage, type DemoScene } from './demo-player';

/* ---------------------------------------------------------------------------
 * Two focused clips. Same engine as the hero film, cropped much tighter:
 * the element editor, and the BYOK provider panel.
 * ------------------------------------------------------------------------- */

const SELECTOR = 'body > main > section:nth-of-type(1) > h2';
const TYPE_EDIT = 'Set the headline to 44px with tight tracking';

/** Close crop of the preview pane with the injected editor overlay. */
function PreviewCrop({
  restyled,
  promoted = false,
  children,
}: {
  restyled: boolean;
  /** Set by the Typography edit the close-up clip applies. */
  promoted?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative h-full overflow-hidden bg-[#e9e7df] p-4">
      <div className="relative h-full overflow-hidden rounded-xl shadow-[0_18px_50px_rgba(20,20,15,0.22)]">
        <GeneratedApp restyled={restyled} promoted={promoted} />
        {children}
      </div>
    </div>
  );
}

export const visualEditorScenes: DemoScene[] = [
  {
    id: 'target',
    label: 'Target',
    duration: 4.5,
    caption: 'Edit mode turns every element in the live preview into a target.',
    render: ({ p }) => {
      const hovering = p > 0.3 && p < 0.55;
      const selected = p >= 0.55;
      return (
        <div className="relative flex h-full flex-col bg-background">
          <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background-subtle px-4 py-2.5">
            <span className="rounded-md bg-background-muted px-2.5 py-1 text-xs font-medium text-foreground">
              Preview
            </span>
            <span className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">
              Edit
            </span>
            <span className="ml-auto rounded-full border border-primary/30 bg-background/90 px-2.5 py-1 text-[10px] font-medium text-primary">
              Click an element to target it
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <PreviewCrop restyled={false}>
              <ElementTarget
                state={selected ? 'selected' : hovering ? 'hover' : 'none'}
                className="left-[4%] top-[28%] h-[14%] w-[52%]"
              />
              {selected && (
                <VisualEditorOverlay
                  selector={SELECTOR}
                  toolIndex={-1}
                  typed=""
                  sent={false}
                  className="bottom-3 left-3 right-3"
                />
              )}
              {p < 0.55 && (
                <DemoCursor x={46} y={p < 0.3 ? 70 : 34} label={hovering ? 'Headline' : 'You'} />
              )}
            </PreviewCrop>
          </div>
        </div>
      );
    },
  },
  {
    id: 'retype',
    label: 'Retype',
    duration: 5.5,
    caption: 'Pick a tool, say what you want, and the element changes in place.',
    render: ({ p }) => {
      const toolPicked = p > 0.22;
      const typed = TYPE_EDIT.slice(0, Math.round(stage(p, 0.24, 0.62) * TYPE_EDIT.length));
      const sent = p >= 0.68;
      const applied = p > 0.74;
      return (
        <div className="relative flex h-full flex-col bg-background">
          <div className="flex shrink-0 items-center gap-3 border-b border-border bg-background-subtle px-4 py-2.5">
            <span className="rounded-md bg-background-muted px-2.5 py-1 text-xs font-medium text-foreground">
              Preview
            </span>
            <span className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">
              Edit
            </span>
            <span className="ml-auto flex items-center gap-1.5 rounded-full border border-primary/30 bg-background/90 px-2.5 py-1 text-[10px] font-medium text-primary">
              <Lock className="h-2.5 w-2.5" />
              data-ve-id → src/App.tsx
            </span>
          </div>
          <div className="min-h-0 flex-1">
            <PreviewCrop restyled={applied} promoted={applied}>
              <ElementTarget state="selected" className="left-[4%] top-[28%] h-[14%] w-[52%]" />
              <VisualEditorOverlay
                selector={SELECTOR}
                toolIndex={toolPicked ? 2 : -1}
                typed={typed}
                sent={sent}
                className="bottom-3 left-3 right-3"
              />
            </PreviewCrop>
          </div>
        </div>
      );
    },
  },
];

export const byokScenes: DemoScene[] = [
  {
    id: 'empty',
    label: 'Providers',
    duration: 4,
    caption: 'Seven providers. Sovereign never holds a key you did not give it.',
    render: () => <SettingsWindow tab="providers" connected={{}} />,
  },
  {
    id: 'add',
    label: 'Add a key',
    duration: 5,
    caption: 'Paste a key — it is encrypted with AES-256-GCM and validated with the provider.',
    render: ({ p }) => (
      <SettingsWindow
        tab="providers"
        connected={p > 0.62 ? { openai: 'sk-proj-••••••••7f3a' } : {}}
        typing={p > 0.3 && p <= 0.62 ? 'openai' : null}
      />
    ),
  },
  {
    id: 'connected',
    label: 'Connected',
    duration: 4.5,
    caption: 'Once a key is live, every model on that provider is available in the composer.',
    render: () => (
      <SettingsWindow
        tab="providers"
        connected={{
          openai: 'sk-proj-••••••••7f3a',
          anthropic: 'sk-ant-••••••••c21d',
          groq: 'gsk_••••••••9d02',
          ollama: 'http://localhost:11434',
        }}
      />
    ),
  },
];

/** Small trust card used beside the BYOK clip. */
export function ByokTrustCard() {
  const rows = [
    { Icon: KeyRound, label: 'AES-256-GCM at rest', copy: 'Keys are encrypted per workspace.' },
    { Icon: ShieldCheck, label: 'SSRF-guarded transport', copy: 'Every provider call is vetted.' },
    { Icon: Lock, label: 'No platform credits', copy: 'You pay the provider directly.' },
  ];
  return (
    <ul className="space-y-3">
      {rows.map(({ Icon, label, copy }) => (
        <li
          key={label}
          className="flex gap-3 rounded-xl border border-border bg-background-subtle p-4"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-primary/20 bg-primary/[0.08]">
            <Icon className="h-4 w-4 text-primary" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">{label}</p>
            <p className="mt-0.5 text-xs leading-5 text-foreground-muted">{copy}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
