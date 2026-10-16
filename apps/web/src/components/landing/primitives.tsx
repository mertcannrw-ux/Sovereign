import type { ReactNode } from 'react';
import { cn } from '@app-builder/ui/utils';

/** Shared easing for the demo films. */
export const ease = [0.22, 1, 0.36, 1] as const;

/**
 * The page column. Its outer edges are where the frame rails run on wide
 * screens, so anything that has to line up with the rails uses this width.
 */
export const COLUMN = 'mx-auto w-full max-w-[1240px]';

/** Horizontal padding inside the column. */
export const GUTTER = 'px-5 sm:px-8 lg:px-12';

/**
 * Registration mark where a section rule crosses a frame rail. Only drawn
 * when the rails are (xl and up), since below that the column is the
 * viewport and there is nothing to cross.
 */
function Crosshair({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('absolute -top-[5px] hidden h-[11px] w-[11px] xl:block', className)}
    >
      <span className="absolute left-0 top-[5px] h-px w-full bg-foreground-muted" />
      <span className="absolute left-[5px] top-0 h-full w-px bg-foreground-muted" />
    </span>
  );
}

/** Both registration marks for a rule along the top edge of its parent. */
export function RuleMarks() {
  return (
    <div className={cn(COLUMN, 'relative')}>
      <Crosshair className="-left-[5px]" />
      <Crosshair className="-right-[5px]" />
    </div>
  );
}

/** The vertical rails that frame the page column. */
export function FrameRails() {
  return (
    <div
      aria-hidden
      className={cn(
        COLUMN,
        'pointer-events-none absolute inset-y-0 left-1/2 z-10 hidden -translate-x-1/2 border-x border-border xl:block',
      )}
    />
  );
}

/**
 * A full-bleed band of the page. Every section opens on a hairline rule that
 * runs edge to edge, with registration marks where it meets the rails.
 */
export function Section({
  id,
  className,
  bodyClassName,
  children,
}: {
  id?: string;
  className?: string;
  /** Overrides the default vertical rhythm of the body. */
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={cn('relative scroll-mt-14 border-t border-border', className)}>
      <RuleMarks />
      <div className={cn(COLUMN, GUTTER, 'py-20 sm:py-28', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Mono section label: an accent square, an index and a name. */
export function Eyebrow({
  index,
  children,
  className,
}: {
  index?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-foreground-secondary',
        className,
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 bg-primary" />
      {index ? <span className="text-foreground-muted">{index}</span> : null}
      <span>{children}</span>
    </p>
  );
}

export function SectionHeading({
  index,
  eyebrow,
  title,
  copy,
  className,
}: {
  index?: string;
  eyebrow?: string;
  title: ReactNode;
  copy?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('max-w-2xl', className)}>
      {eyebrow ? <Eyebrow index={index}>{eyebrow}</Eyebrow> : null}
      <h2
        className={cn(
          'text-balance text-[clamp(2rem,4.2vw,3.25rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-foreground',
          eyebrow && 'mt-6',
        )}
      >
        {title}
      </h2>
      {copy ? (
        <p className="mt-5 max-w-xl text-pretty text-base leading-7 text-foreground-muted">
          {copy}
        </p>
      ) : null}
    </div>
  );
}

/** Primary action: the one place the accent fills a surface. */
export const primaryButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/** Secondary action: an outlined control that stays legible unfocused. */
export const secondaryButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md border border-border-strong px-5 text-sm font-medium text-foreground transition-colors hover:bg-background-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40';
