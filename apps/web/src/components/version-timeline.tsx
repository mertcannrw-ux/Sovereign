'use client';

import { useMemo, useCallback, useState } from 'react';
import { cn } from '@app-builder/ui/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { History, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';

export interface VersionTimelineEntry {
  id: string;
  versionNumber: number;
  createdAt: Date;
  fileCount: number;
  isRestore?: boolean;
}

interface VersionTimelineProps {
  /** All versions in chronological order (ascending). */
  versions: VersionTimelineEntry[];
  /** The currently selected/previewed version number. */
  currentVersion: number;
  /** Called when a version dot is clicked. */
  onSelectVersion: (versionNumber: number) => void;
  /** Called when the restore button is clicked for a version. */
  onRestoreVersion: (versionNumber: number) => void;
  /** Whether the timeline is in a loading state. */
  isLoading?: boolean;
  className?: string;
}

export function VersionTimeline({
  versions,
  currentVersion,
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
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Show up to 24 dots; if more versions exist, compact
  const displayVersions = useMemo(() => {
    if (versions.length <= 24) return versions;
    // Thin out middle versions for compactness
    const keep = 20;
    const head = versions.slice(0, Math.ceil(keep / 2));
    const tail = versions.slice(-Math.floor(keep / 2));
    return [...head, ...tail];
  }, [versions]);

  const handleRestore = useCallback(
    async (e: React.MouseEvent, versionNumber: number) => {
      e.stopPropagation();
      setRestoreError(null);
      setRestoringVersion(versionNumber);
      try {
        await onRestoreVersion(versionNumber);
      } catch {
        setRestoreError('Failed to restore version. Please try again.');
      } finally {
        setRestoringVersion(null);
      }
    },
    [onRestoreVersion],
  );

  if (isLoading) {
    return (
      <div className={cn('flex items-center gap-2 px-3 py-2', className)}>
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <span className="text-xs text-foreground-muted">Loading versions…</span>
      </div>
    );
  }

  if (versions.length === 0) {
    return (
      <div className={cn('flex items-center gap-2 px-3 py-2 text-foreground-muted', className)}>
        <History className="h-4 w-4" />
        <span className="text-xs">No versions yet</span>
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-1 overflow-x-auto px-3 py-2',
          'scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent',
          className,
        )}
      >
        <History className="mr-1 h-3.5 w-3.5 shrink-0 text-foreground-muted" />

        {/* Scroll hint arrows */}
        <ChevronLeft className="h-3 w-3 shrink-0 text-foreground-muted/50 md:hidden" />

        <div className="flex items-center gap-0.5">
          {displayVersions.map((v) => {
            const isCurrent = v.versionNumber === currentVersion;
            const isLatest = v.versionNumber === maxVersion;
            const isRestoreMarker = v.isRestore;

            return (
              <TooltipProvider key={v.id} delayDuration={400}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => onSelectVersion(v.versionNumber)}
                      className={cn(
                        'relative flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-medium transition-all',
                        'hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        isCurrent && 'bg-primary text-white shadow-sm ring-2 ring-primary',
                        !isCurrent &&
                          isRestoreMarker &&
                          'border border-warning/30 bg-warning-light text-warning',
                        !isCurrent &&
                          !isRestoreMarker &&
                          isLatest &&
                          'border border-primary/20 bg-primary-light text-primary',
                        !isCurrent &&
                          !isRestoreMarker &&
                          !isLatest &&
                          'border border-border bg-background-muted text-foreground-secondary hover:bg-background-subtle',
                      )}
                      aria-label={`Version ${v.versionNumber}${isCurrent ? ' (current)' : ''}`}
                    >
                      {isRestoreMarker ? <RotateCcw className="h-3 w-3" /> : v.versionNumber}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="center" className="max-w-56">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">
                        {isRestoreMarker
                          ? `Restore Point ${v.versionNumber}`
                          : `Version ${v.versionNumber}`}
                      </p>
                      <p className="text-foreground-muted">{formatVersionTime(v.createdAt)}</p>
                      {v.fileCount > 0 && !isRestoreMarker && (
                        <p className="text-foreground-muted">
                          {v.fileCount} file{v.fileCount !== 1 ? 's' : ''} modified
                        </p>
                      )}
                      {isCurrent && (
                        <span className="inline-block rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          Current
                        </span>
                      )}
                      {isLatest && !isCurrent && (
                        <span className="inline-block rounded bg-primary-light px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          Latest
                        </span>
                      )}
                      <div className="pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 w-full text-[11px]"
                          onClick={(e) => handleRestore(e, v.versionNumber)}
                          disabled={isCurrent || restoringVersion === v.versionNumber}
                        >
                          <RotateCcw className="mr-1 h-3 w-3" />
                          {isCurrent ? 'Current' : 'Restore'}
                        </Button>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })}
        </div>

        <ChevronRight className="h-3 w-3 shrink-0 text-foreground-muted/50 md:hidden" />

        {/* Current version label */}
        <span className="ml-2 shrink-0 text-[10px] text-foreground-muted">
          v{currentVersion}
          {currentVersion < maxVersion ? ` of ${maxVersion}` : ''}
        </span>
      </div>
      {restoreError && (
        <p className="px-3 pb-2 text-xs text-error" role="alert">
          {restoreError}
        </p>
      )}
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
