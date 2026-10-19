import { Command } from 'lucide-react';
import { cn } from '@app-builder/ui/utils';

const sizes = {
  // App sidebar: dark tile with a lime glyph, sentence-case wordmark.
  nav: {
    gap: 'gap-2.5',
    tile: 'h-7 w-7 rounded-[7px] border border-border bg-background-subtle text-primary',
    glyph: 'h-4 w-4',
    word: 'text-base font-semibold',
  },
  sm: {
    gap: 'gap-2.5',
    tile: 'h-7 w-7 rounded-control bg-primary text-primary-foreground',
    glyph: 'h-4 w-4',
    word: 'text-[13px] font-semibold uppercase tracking-[0.2em]',
  },
  md: {
    gap: 'gap-2.5',
    tile: 'h-8 w-8 rounded-control bg-primary text-primary-foreground',
    glyph: 'h-4 w-4',
    word: 'text-sm font-bold uppercase tracking-[0.2em]',
  },
  lg: {
    gap: 'gap-3.5',
    tile: 'h-10 w-10 rounded-control bg-primary text-primary-foreground',
    glyph: 'h-5 w-5',
    word: 'text-base font-bold uppercase tracking-[0.22em]',
  },
} as const;

/**
 * The glyph inside the tile. To use a custom mark, replace this with an inline
 * SVG: give it `className` for sizing and draw with `currentColor` so it takes
 * the tile's colour (lime in the sidebar, dark on the lime tiles).
 */
function LogoGlyph({ className }: { className?: string }) {
  return <Command className={className} strokeWidth={2.5} aria-hidden />;
}

/**
 * The Sovereign mark: tile, glyph, wordmark (uppercase except in the
 * sidebar). The one place the logo is drawn - the marketing header, auth
 * screens, sidebar and mobile headers all render this, so swapping the mark
 * is a one-file change. Flat: no glow.
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
      <span className={cn('grid shrink-0 place-items-center', s.tile)}>
        <LogoGlyph className={s.glyph} />
      </span>
      {!compact && <span className={cn('text-foreground', s.word)}>Sovereign</span>}
    </span>
  );
}
