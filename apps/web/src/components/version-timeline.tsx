'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@app-builder/ui/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { History, RotateCcw } from 'lucide-react';

export interface VersionTimelineEntry {
  id: string;
  versionNumber: number;
  createdAt: Date;
  /** Number of file operations recorded in the snapshot. */
  fileCount: number;
  /** Snapshot message; restore points carry "Restored version N". */
  message?: string | null;
  /** True for restore-point snapshots. */
  isRestore?: boolean;
}

interface VersionTimelineProps {
  /** Every version, ascending. Nothing is hidden — a long history scrolls. */
  versions: VersionTimelineEntry[];
  /** The version the project is currently at. */
  currentVersion: number;
  /** The version the user is inspecting; doubles as the restore target. */
  selectedVersion: number;
  /** Called when a version dot is clicked. */
  onSelectVersion: (versionNumber: number) => void;
  /** Applies `versionNumber`. Rejections surface inline; pending state is internal. */
  onRestoreVersion: (versionNumber: number) => Promise<void>;
  /** Initial load of the version list. */
  isLoading?: boolean;
  className?: string;
}

export function VersionTimeline({
  versions,
  currentVersion,
  selectedVersion,
  onSelectVersion,
  onRestoreVersion,
  isLoading = false,
  className,
}: VersionTimelineProps) {
  const maxVersion = useMemo(
    () => (versions.length > 0 ? versions[versions.length - 1]!.versionNumber : 0),
    [versions],
  );
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const [restoreError, setRestoreError] = useState<{
    versionNumber: number;
    message: string;
  } | null>(null);
  const selectedDotRef = useRef<HTMLButtonElement | null>(null);

  // `currentVersion` is 0 until the version list loads; the latest version is
  // the only sensible default, so the strip never renders a "v0" state.
  const effectiveCurrentVersion = currentVersion > 0 ? currentVersion : maxVersion;
  const effectiveSelectedVersion = selectedVersion > 0 ? selectedVersion : effectiveCurrentVersion;
  const isViewingOlderVersion = effectiveSelectedVersion !== effectiveCurrentVersion;

  // A long history scrolls. Keep the selected dot in view when selection moves
  // (click, keyboard, or the selection following a new/restored version).
  useEffect(() => {
    selectedDotRef.current?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [effectiveSelectedVersion]);

  const handleRestore = useCallback(async () => {
    if (restoringVersion !== null) return;
    setRestoreError(null);
    setRestoringVersion(effectiveSelectedVersion);
    try {
      await onRestoreVersion(effectiveSelectedVersion);
    } catch {
      setRestoreError({
        versionNumber: effectiveSelectedVersion,
        message: `Could not restore version ${effectiveSelectedVersion}. Please try again.`,
      });
    } finally {
      setRestoringVersion(null);
    }
  }, [effectiveSelectedVersion, onRestoreVersion, restoringVersion]);

  if (isLoading) {
    return (
      <div
        className={cn('flex items-center gap-2 px-3 py-2', className)}
        role="status"
        aria-live="polite"
      >
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-xs text-foreground-muted">Loading versions…</span>
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className={cn('flex items-center gap-2 px-3 py-2 text-foreground-muted', className)}>
        <History className="h-4 w-4" aria-hidden="true" />
        <span className="text-xs">No versions yet</span>
      </div>
    );
  }

  return (
    <>
      <div className={cn('flex items-center gap-2 px-3 py-2', className)}>
        <History className="h-3.5 w-3.5 shrink-0 text-foreground-muted" aria-hidden="true" />

        <div className="min-w-0 flex-1 overflow-x-auto">
          <TooltipProvider delayDuration={400}>
            <ol className="flex w-max items-center gap-0.5" aria-label="Version history">
              {versions.map((v) => {
                const isSelected = v.versionNumber === effectiveSelectedVersion;
                const isCurrent = v.versionNumber === effectiveCurrentVersion;
                const isRestorePoint = v.isRestore === true;

                return (
                  <li key={v.id}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          ref={isSelected ? selectedDotRef : undefined}
                          onClick={() => onSelectVersion(v.versionNumber)}
                          disabled={restoringVersion !== null}
                          aria-current={isSelected ? 'true' : undefined}
                          aria-label={`Version ${v.versionNumber}${
                            isRestorePoint ? ' (restore point)' : ''
                          }${isCurrent ? ', current version' : ''}`}
                          className={cn(
                            'relative flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-medium transition-all',
                            'hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40',
                            'disabled:cursor-not-allowed disabled:opacity-60',
                            isSelected &&
                              'bg-primary text-primary-foreground shadow-sm ring-2 ring-primary',
                            !isSelected &&
                              isRestorePoint &&
                              'border border-warning/30 bg-warning-light text-warning',
                            !isSelected &&
                              !isRestorePoint &&
                              'border border-border bg-background-muted text-foreground-secondary hover:bg-background-subtle',
                          )}
                        >
                          {isRestorePoint ? (
                            <RotateCcw className="h-3 w-3" aria-hidden="true" />
                          ) : (
                            v.versionNumber
                          )}
                          {isCurrent ? (
                            <span
                              aria-hidden="true"
                              className={cn(
                                'absolute bottom-0.5 h-0.5 w-2 rounded-full',
                                isSelected ? 'bg-primary-foreground' : 'bg-primary/70',
                              )}
                            />
                          ) : null}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" align="center" className="max-w-56">
                        <div className="space-y-1">
                          <p className="font-medium text-foreground">
                            {isRestorePoint
                              ? `Restore point ${v.versionNumber}`
                              : `Version ${v.versionNumber}`}
                          </p>
                          <p className="text-foreground-muted">{formatVersionTime(v.createdAt)}</p>
                          {v.message ? <p className="text-foreground-muted">{v.message}</p> : null}
                          {v.fileCount > 0 ? (
                            <p className="text-foreground-muted">
                              {v.fileCount} file{v.fileCount === 1 ? '' : 's'} changed
                            </p>
                          ) : null}
                          {isCurrent ? (
                            <span className="inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                              Current
                            </span>
                          ) : v.versionNumber === maxVersion ? (
                            <span className="inline-block rounded bg-primary-light px-1.5 py-0.5 text-[10px] font-medium text-primary">
                              Latest
                            </span>
                          ) : null}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </li>
                );
              })}
            </ol>
          </TooltipProvider>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span className="text-[10px] text-foreground-muted" aria-live="polite">
            {isViewingOlderVersion
              ? `Viewing v${effectiveSelectedVersion} of ${maxVersion}`
              : `v${effectiveCurrentVersion}`}
          </span>
          {isViewingOlderVersion ? (
            <Button
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              onClick={() => void handleRestore()}
              disabled={restoringVersion !== null}
              aria-busy={restoringVersion !== null}
            >
              <RotateCcw className="mr-1 h-3 w-3" aria-hidden="true" />
              {restoringVersion !== null ? 'Restoring…' : `Restore v${effectiveSelectedVersion}`}
            </Button>
          ) : null}
        </div>
      </div>
      {restoreError && restoreError.versionNumber === effectiveSelectedVersion ? (
        <p className="px-3 pb-2 text-xs text-error" role="alert">
          {restoreError.message}
        </p>
      ) : null}
    </>
  );
}

function formatVersionTime(date: Date): string {
  const now = Date.now();
  const then = date.getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
