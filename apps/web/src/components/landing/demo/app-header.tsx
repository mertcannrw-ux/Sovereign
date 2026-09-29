'use client';

import { ArrowLeft, History, RotateCcw, Rocket, Settings } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';

/**
 * The project editor header, rebuilt from `app/project/[id]/page.tsx`:
 * a 68px bar with a back-to-dashboard ghost button, a vertical separator,
 * the editable project name, then Deploy (Rocket) and Settings on the right.
 */
export function EditorHeader({
  projectName,
  deploying = false,
}: {
  projectName: string;
  deploying?: boolean;
}) {
  return (
    <header className="flex h-[68px] shrink-0 items-center gap-3.5 border-b border-border bg-background px-4 sm:px-5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-foreground-muted">
        <ArrowLeft className="h-4 w-4" />
      </span>
      <span className="h-5 w-px shrink-0 bg-border" />
      <span className="truncate text-[15px] font-bold tracking-tight text-foreground">
        {projectName}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <span className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground shadow-[0_1px_0_rgba(255,255,255,0.18)_inset]">
          <Rocket className="h-4 w-4" />
          {deploying ? 'Deploying…' : 'Deploy'}
        </span>
        <span className="grid h-9 w-9 place-items-center rounded-lg text-foreground-muted">
          <Settings className="h-4 w-4" />
        </span>
      </div>
    </header>
  );
}

export interface DemoVersion {
  n: number;
  /** File operations recorded in that snapshot, shown in the tooltip. */
  files: number;
  /** Restore points carry a RotateCcw glyph, exactly as in the real strip. */
  restore?: boolean;
}

/**
 * `components/version-timeline.tsx`: a `History` glyph, one dot per version
 * ascending, restore points tinted with the warning colour, the current
 * version underlined, and the `v{n}` label on the right. Hovering a dot
 * raises the same tooltip the shipped component builds.
 */
export function VersionStrip({
  versions,
  current,
  selected,
  showRestoreButton = false,
}: {
  versions: DemoVersion[];
  current: number;
  selected?: number;
  showRestoreButton?: boolean;
}) {
  const active = selected ?? current;
  const viewingOlder = active !== current;

  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-border bg-background-subtle px-4">
      <History className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
      <ol className="flex min-w-0 flex-1 items-center gap-0.5" aria-label="Version history">
        {versions.map((version) => {
          const isCurrent = version.n === current;
          const isSelected = version.n === active;
          return (
            <li key={version.n} className="group relative flex items-center">
              <span
                className={cn(
                  'grid h-6 w-6 place-items-center rounded-full border text-[10px] font-semibold transition-colors',
                  isSelected
                    ? 'border-primary/50 bg-primary/15 text-primary'
                    : 'border-border bg-background-muted text-foreground-muted',
                  isCurrent &&
                    !isSelected &&
                    'border-foreground-muted/60 text-foreground-secondary',
                )}
              >
                {version.restore ? <RotateCcw className="h-2.5 w-2.5 text-warning" /> : version.n}
              </span>
              {version.n < versions[versions.length - 1]!.n && (
                <span
                  className={cn('h-px w-4', version.n < current ? 'bg-primary/30' : 'bg-border')}
                />
              )}
              <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-border bg-background px-2.5 py-1.5 text-[10px] text-foreground-secondary shadow-lg group-hover:block">
                {version.restore ? `Restore point ${version.n}` : `Version ${version.n}`} ·{' '}
                {version.files} files changed
                {isCurrent ? ' · Current' : ''}
              </span>
            </li>
          );
        })}
      </ol>
      {showRestoreButton ? (
        <span className="flex h-7 shrink-0 items-center rounded-lg border border-border bg-background px-3 text-[11px] font-medium text-foreground-secondary">
          Restore v{active}
        </span>
      ) : (
        <span className="shrink-0 text-[11px] text-foreground-muted">v{current}</span>
      )}
      {viewingOlder && !showRestoreButton && (
        <span className="shrink-0 text-[11px] text-warning">
          Viewing v{active} of {current}
        </span>
      )}
    </div>
  );
}
