'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VersionTimeline, type VersionTimelineProps } from '@/components/version-timeline';

/**
 * The editor header's version history: a clock button that drops the version
 * timeline down in a panel. Closes on Escape or a click outside.
 */
export function VersionHistoryMenu(props: VersionTimelineProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9 rounded-lg hover:bg-white/10 data-[open=true]:bg-background-muted"
        data-open={open}
        onClick={() => setOpen((value) => !value)}
        aria-label="Version history"
        aria-expanded={open}
        aria-controls={panelId}
        title="Version history"
      >
        <Clock className="h-4 w-4" />
      </Button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Version history"
          className="absolute right-0 top-full z-50 mt-2 w-[min(360px,calc(100vw-2rem))] rounded-popover border border-border bg-background-subtle shadow-popover"
        >
          <VersionTimeline {...props} />
        </div>
      )}
    </div>
  );
}
