'use client';

import {
  Check,
  Code,
  Crosshair,
  Eye,
  FileCode2,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@app-builder/ui/utils';
import { GeneratedApp } from './generated-app';

/* ---------------------------------------------------------------------------
 * Rebuilt from the shipped panes:
 *   app/project/[id]/page.tsx  — Preview/Code tabs, Edit toggle, refresh
 *   components/project/preview-pane.tsx — sandbox boot copy, edit-mode pill
 *   components/project/code-pane.tsx    — 176px file list, editor surface
 *   lib/visual-editor.ts       — the overlay injected into the preview
 * ------------------------------------------------------------------------- */

export function PaneTabs({
  tab,
  editMode,
  onTab,
  onEdit,
  onRefresh,
}: {
  tab: 'preview' | 'code';
  editMode: boolean;
  onTab?: (tab: 'preview' | 'code') => void;
  onEdit?: () => void;
  onRefresh?: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background-subtle px-2.5 py-2 sm:gap-3 sm:px-3">
      <div
        role="tablist"
        aria-label="Workspace view"
        className="flex h-8 shrink-0 items-center gap-0.5 rounded-lg bg-background-muted p-1"
      >
        {(
          [
            { id: 'preview', label: 'Preview', Icon: Eye },
            { id: 'code', label: 'Code', Icon: Code },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTab?.(id)}
            className={cn(
              'inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-all sm:px-2.5',
              tab === id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-foreground-muted hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <button
        type="button"
        aria-pressed={editMode}
        onClick={onEdit}
        className={cn(
          'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border px-2 text-xs font-medium transition-all sm:px-2.5',
          editMode
            ? 'bg-primary text-primary-foreground'
            : 'bg-background-muted text-foreground-muted hover:text-foreground',
        )}
      >
        <Crosshair className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Edit</span>
      </button>

      <button
        type="button"
        aria-label="Refresh preview"
        onClick={onRefresh}
        className="ml-auto grid h-8 w-8 shrink-0 place-items-center rounded-md text-foreground-muted transition-colors hover:bg-white/10 hover:text-foreground"
      >
        <RefreshCw className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/** The sandboxed iframe's boot state, verbatim from `preview-pane.tsx`. */
export function PreviewBooting({ progress }: { progress: number }) {
  const stage = progress < 0.35 ? 0 : progress < 0.75 ? 1 : 2;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-background px-6 text-center">
      <Loader2 className="h-5 w-5 animate-spin text-primary" />
      <p className="text-xs font-medium text-foreground-secondary">
        {stage === 0 ? 'Starting secure preview sandbox' : 'Booting browser-based Node.js runtime…'}
      </p>
      <div className="h-1 w-40 overflow-hidden rounded-full bg-background-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300"
          style={{ width: `${Math.min(100, progress * 100)}%` }}
        />
      </div>
    </div>
  );
}

export function PreviewSurface({
  booted,
  bootProgress,
  editMode,
  restyled,
  children,
}: {
  booted: boolean;
  bootProgress: number;
  editMode: boolean;
  restyled: boolean;
  children?: React.ReactNode;
}) {
  if (!booted) return <PreviewBooting progress={bootProgress} />;

  return (
    <div className="relative h-full overflow-hidden bg-[#e9e7df] p-3 sm:p-4">
      {editMode && (
        <span className="absolute left-1/2 top-3 z-30 -translate-x-1/2 rounded-full border border-primary/30 bg-background/90 px-2.5 py-1 text-[10px] font-medium text-primary backdrop-blur">
          Click an element to target it
        </span>
      )}
      <div className="relative h-full overflow-hidden rounded-xl shadow-[0_18px_50px_rgba(20,20,15,0.22)]">
        <GeneratedApp restyled={restyled} />
        {children}
      </div>
    </div>
  );
}

/**
 * The overlay `lib/visual-editor.ts` injects into the generated document:
 * a lime CSS-path label, seven tool chips, and the "What to change?" prompt
 * row. Colours and geometry match the injected stylesheet.
 */
const TOOLS = [
  { label: 'Text', prompt: 'Change the text to ' },
  { label: 'Color', prompt: 'Change the colors: ' },
  { label: 'Typography', prompt: 'Update the typography: ' },
  { label: 'Spacing', prompt: 'Adjust the spacing: ' },
  { label: 'Layout', prompt: 'Change the layout and alignment: ' },
  { label: 'Border', prompt: 'Change the border and corner radius: ' },
  { label: 'Effects', prompt: 'Add or change the visual effects: ' },
] as const;

export function VisualEditorOverlay({
  selector,
  toolIndex,
  typed,
  sent,
  className,
}: {
  selector: string;
  /** Index into TOOLS, or -1 when none is active. */
  toolIndex: number;
  typed: string;
  /** True once the request has been sent — dims the send button again. */
  sent: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn('pointer-events-none absolute left-4 right-4 z-40', className)}
      style={{ filter: 'drop-shadow(0 16px 32px rgba(0,0,0,0.6))' }}
    >
      {/* .sv-label — lime mono chip pinned above the element */}
      <span
        className="ml-1 inline-block rounded-t-md rounded-bl-md px-2 py-[3px] font-mono text-[10px] font-semibold leading-4"
        style={{ background: '#B8FF5A', color: '#10130c' }}
      >
        {selector}
      </span>

      {/* .sv-tools */}
      <div
        className="flex gap-1 overflow-x-auto rounded-t-[14px] border border-b-0 border-white/[0.14] p-1.5"
        style={{ background: '#161618' }}
      >
        {TOOLS.map((tool, index) => (
          <span
            key={tool.label}
            className={cn(
              'whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
              index === toolIndex
                ? 'border-primary/30 bg-primary/15 text-primary'
                : 'border-transparent bg-white/[0.05] text-[#b8b8b2]',
            )}
          >
            {tool.label}
          </span>
        ))}
      </div>

      {/* .sv-prompt */}
      <div
        className="flex items-center gap-2 rounded-b-[14px] border border-white/[0.14] p-2"
        style={{ background: '#101012' }}
      >
        <span
          aria-label="Clear selected element"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-base text-[#b8b8b2]"
          style={{ background: 'rgba(255,255,255,0.08)' }}
        >
          ‹
        </span>
        <span className="min-w-0 flex-1 truncate px-1 text-[13px] leading-[18px] text-[#f7f7f5]">
          {typed || <span className="text-[#74746e]">What to change?</span>}
        </span>
        <span
          aria-label="Send element edit"
          className={cn(
            'grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[15px] font-bold transition-colors',
            sent
              ? 'text-primary/50'
              : 'bg-[#B8FF5A] text-[#10130c] shadow-[0_0_12px_rgba(184,255,90,0.35)]',
          )}
          style={!sent ? undefined : { background: 'rgba(184,255,90,0.2)' }}
        >
          ↑
        </span>
      </div>
    </div>
  );
}

/** The dashed hover outline / solid selected outline the overlay draws. */
export function ElementTarget({
  state,
  className,
  style,
}: {
  state: 'none' | 'hover' | 'selected';
  className?: string;
  style?: React.CSSProperties;
}) {
  if (state === 'none') return null;
  return (
    <span
      aria-hidden
      className={cn('pointer-events-none absolute z-30', className)}
      style={{
        outline: state === 'hover' ? '2px dashed #B8FF5A' : '2px solid #B8FF5A',
        outlineOffset: 2,
        borderRadius: 4,
        boxShadow:
          state === 'hover'
            ? '0 0 8px rgba(184,255,90,0.35)'
            : '0 0 0 3px rgba(184,255,90,0.25), 0 0 16px rgba(184,255,90,0.3)',
        ...style,
      }}
    />
  );
}

/** The moving pointer the preview pane overlays during element targeting. */
export function DemoCursor({ x, y, label = 'You' }: { x: number; y: number; label?: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute z-50 transition-[left,top] duration-500 ease-linear"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <svg width="16" height="18" viewBox="0 0 16 18" fill="none" className="drop-shadow">
        <path
          d="M1 1L15 9.5L8.2 11.2L5.4 17L1 1Z"
          fill="#0B0B0B"
          stroke="#B8FF5A"
          strokeWidth="1"
        />
      </svg>
      <span className="ml-3 mt-1 inline-block rounded bg-[#B8FF5A] px-1.5 py-0.5 text-[9px] font-semibold text-[#10130c]">
        {label}
      </span>
    </span>
  );
}

const APP_TSX = `import { useMemo, useState } from 'react';
import { MetricCard } from './components/MetricCard';
import { OutputChart } from './components/OutputChart';
import { sites } from './lib/data';

export default function App() {
  const [range, setRange] = useState<'7d' | '30d'>('7d');
  const total = useMemo(
    () => sites.reduce((sum, site) => sum + site.output, 0),
    [sites],
  );

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Live network</h1>
        <RangeToggle value={range} onChange={setRange} />
      </header>
      <section className="mt-8 grid grid-cols-3 gap-4">
        {sites.map((site) => (
          <MetricCard key={site.id} {...site} />
        ))}
      </section>
      <OutputChart total={total} range={range} />
    </main>
  );
}`;

export function CodePaneView({
  files,
  active,
  streaming,
}: {
  files: string[];
  active: string;
  /** Reveals the AI cursor on the last line while the agent is writing. */
  streaming?: boolean;
}) {
  const lines = APP_TSX.split('\n');
  const visible = lines.slice(0, Math.max(6, streaming ? lines.length : 14));

  return (
    <div className="flex h-full min-h-0 bg-background-subtle">
      <div className="w-44 shrink-0 overflow-hidden border-r border-white/10 py-2">
        {files.map((file) => (
          <div
            key={file}
            className={cn(
              'flex w-full items-center gap-2 truncate px-3 py-1.5 text-[11px]',
              file === active ? 'bg-white/10 text-foreground' : 'text-foreground-secondary',
            )}
          >
            <FileCode2 className="h-3 w-3 shrink-0" />
            <span className="truncate">{file}</span>
            {file === active && streaming && (
              <span className="ml-auto h-1.5 w-1.5 shrink-0 animate-ping rounded-full bg-primary/60" />
            )}
          </div>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 flex-col" style={{ background: '#1e1e1e' }}>
        <div className="flex shrink-0 items-center gap-2 border-b border-[#333] px-4 py-2">
          <span className="truncate font-mono text-[11px] text-[#d4d4d4]">{active}</span>
          <span className="ml-auto inline-flex items-center gap-1 rounded border border-[#3a3a3a] px-1.5 py-0.5 text-[10px] text-[#9a9a95]">
            <Check className="h-2.5 w-2.5 text-primary" />
            Version 7 snapshot
          </span>
        </div>
        <pre className="min-h-0 flex-1 overflow-hidden p-4 font-mono text-[11px] leading-5 text-[#d4d4d4]">
          {visible.map((line, index) => (
            <div key={index} className="flex gap-3">
              <span className="w-4 shrink-0 select-none text-right text-[#555]">{index + 1}</span>
              <code className="min-w-0 truncate">
                <SyntaxHighlight line={line} />
              </code>
              {streaming && index === visible.length - 1 && (
                <span className="animate-caret inline-block h-3.5 w-[7px] shrink-0 bg-primary" />
              )}
            </div>
          ))}
        </pre>
        <div className="shrink-0 border-t border-[#333] px-4 py-1.5 text-[10px] text-[#8a8a85]">
          File truncated for display…
        </div>
      </div>
    </div>
  );
}

/** Static keyword table for the miniature tokeniser. */
const TS_KEYWORD: Record<string, true> = {
  import: true,
  from: true,
  export: true,
  default: true,
  function: true,
  const: true,
  let: true,
  return: true,
  useState: true,
};

/** Minimal TSX tokeniser — enough colour to read as a real editor. */
function SyntaxHighlight({ line }: { line: string }) {
  const parts = line.split(/(\b[A-Za-z_$][\w$]*\b|'[^']*'|"[^"]*")/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) => {
        let colour: string | undefined;
        if (part.startsWith("'") || part.startsWith('"')) colour = '#ce9178';
        else if (TS_KEYWORD[part]) colour = '#c586c0';
        else if (/^[A-Z]/.test(part)) colour = '#4ec9b0';
        else if (part.startsWith('<')) colour = '#569cd6';
        return colour ? (
          <span key={index} style={{ color: colour }}>
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        );
      })}
    </>
  );
}
