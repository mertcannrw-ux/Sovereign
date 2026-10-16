'use client';

import { Plus } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { cn } from '@app-builder/ui/utils';

/**
 * Accordion panel that animates open/closed. Native <details> toggles
 * instantly, so the panel height is driven instead: a zero-row to one-row
 * grid transition animates an unknown-height answer smoothly. While collapsed
 * the answer is `inert`, so screen readers skip what sighted users cannot see.
 */
export function FaqItem({ q, children }: { q: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <div>
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-start justify-between gap-6 py-5 text-left text-[15px] font-medium tracking-[-0.01em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40"
        >
          {q}
          <Plus
            aria-hidden
            className={cn(
              'mt-0.5 h-4 w-4 shrink-0 text-foreground-muted transition-transform duration-200',
              open && 'rotate-45',
            )}
          />
        </button>
      </h3>
      <div
        id={panelId}
        inert={!open}
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="min-h-0 overflow-hidden">
          <p className="max-w-2xl pb-5 text-sm leading-7 text-foreground-muted">{children}</p>
        </div>
      </div>
    </div>
  );
}
