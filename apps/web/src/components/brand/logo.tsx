import { Command } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';

const sizes = {
  sm: {
    gap: 'gap-2.5',
    tile: 'h-7 w-7 rounded-control',
    glyph: 'h-4 w-4',
    word: 'text-[13px] font-semibold tracking-[0.2em]',
  },
  md: {
    gap: 'gap-2.5',
    tile: 'h-8 w-8 rounded-control',
    glyph: 'h-4 w-4',
    word: 'text-sm font-bold tracking-[0.2em]',
  },
  lg: {
    gap: 'gap-3.5',
    tile: 'h-10 w-10 rounded-control',
    glyph: 'h-5 w-5',
    word: 'text-base font-bold tracking-[0.22em]',
  },
} as const;

/**
 * The Sovereign mark: accent tile, Command glyph, uppercase wordmark. The one
 * place the logo is drawn - the marketing header, auth screens, sidebar and
 * mobile header all render this, so swapping the mark is a one-file change.
 * Flat: no glow.
 */
export function Logo({
  className,
  compact = false,
  size = 'sm',
}: {
  className?: string;
  compact?: boolean;
  size?: keyof typeof sizes;
}) {
  const s = sizes[size];
  return (
    <span className={cn('flex items-center', s.gap, className)}>
      <span className={cn('grid place-items-center bg-primary text-primary-foreground', s.tile)}>
        <Command className={s.glyph} strokeWidth={2.5} />
      </span>
      {!compact && <span className={cn('uppercase text-foreground', s.word)}>Sovereign</span>}
    </span>
  );
}
