import { cn } from '@app-builder/ui/utils';

/**
 * The sidebar's navigation icons, drawn as one set: a 20px grid, 1.5px
 * strokes with round caps and joins, and 2px corner radii, so they read as a
 * family next to the logo. Active icons pick up a faint fill of their own
 * colour as well as the colour change, so the current page shows in shape,
 * not only in hue.
 */
export interface NavIconProps {
  active?: boolean;
  className?: string;
}

function NavIconSvg({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn('h-5 w-5 shrink-0', className)}
    >
      {children}
    </svg>
  );
}

/** Shapes that take the active fill. */
function Filled({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <g fill={active ? 'currentColor' : 'none'} fillOpacity={0.16}>
      {children}
    </g>
  );
}

/** Projects: a folder with its front flap, the universal "your work" sign. */
export function ProjectsIcon({ active, className }: NavIconProps) {
  return (
    <NavIconSvg className={className}>
      <Filled active={active}>
        <path d="M2.75 5.75a2 2 0 0 1 2-2h3.13a1.5 1.5 0 0 1 1.06.44l1.37 1.37a1.5 1.5 0 0 0 1.06.44h3.88a2 2 0 0 1 2 2v6.25a2 2 0 0 1-2 2H4.75a2 2 0 0 1-2-2Z" />
      </Filled>
      <path d="M2.75 8.75h14.5" />
    </NavIconSvg>
  );
}

/** New project: a plus on the same grid and stroke as the rest of the set. */
export function NewProjectIcon({ className }: Omit<NavIconProps, 'active'>) {
  return (
    <NavIconSvg className={className}>
      <path d="M10 4.75v10.5M4.75 10h10.5" />
    </NavIconSvg>
  );
}
