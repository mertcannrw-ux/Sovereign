import { Command } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';

/**
 * The Sovereign mark. Mirrors `components/layout/sidebar.tsx` (accent tile,
 * Command glyph, uppercase wordmark) so the marketing header and the
 * signed-in app read as one product. Flat: no glow.
 */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
        <Command className="h-4 w-4" strokeWidth={2.5} />
      </span>
      {!compact && (
        <span className="text-[13px] font-semibold uppercase tracking-[0.2em] text-foreground">
          Sovereign
        </span>
      )}
    </span>
  );
}
