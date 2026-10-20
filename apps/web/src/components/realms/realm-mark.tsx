import { cn } from '@app-builder/ui/utils';

/**
 * A Realm's tile: its initial on the neutral fill. Neutral on purpose - lime
 * marks actions, not identity (design.md §2.3).
 */
export function RealmMark({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-item border border-border-strong bg-background-muted text-xs font-semibold text-foreground-secondary',
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || 'R'}
    </span>
  );
}
