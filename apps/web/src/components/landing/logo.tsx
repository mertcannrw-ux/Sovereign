import { Command } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';

/**
 * The Sovereign mark. Mirrors `components/layout/sidebar.tsx` — rounded-xl
 * accent tile, Command glyph, uppercase wordmark at 0.22em tracking — so the
 * marketing header and the signed-in app read as one product.
 */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('flex items-center gap-3', className)}>
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_0_0_1px_rgba(184,255,90,0.35),0_10px_30px_-8px_rgba(184,255,90,0.55)]">
        <Command className="h-5 w-5" strokeWidth={2.5} />
      </span>
      {!compact && (
        <span className="text-base font-bold uppercase tracking-[0.22em] text-foreground">
          Sovereign
        </span>
      )}
    </span>
  );
}
