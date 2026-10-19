'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { cn } from '@app-builder/ui/utils';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { isTypingTarget } from '@/lib/keyboard';
import { NewProjectIcon, ProjectsIcon, TeamIcon, type NavIconProps } from './nav-icons';
import { Settings, X, PanelLeftClose, PanelLeft, LogOut, Ellipsis } from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Projects', icon: ProjectsIcon },
  { href: '/dashboard/team', label: 'Team', icon: TeamIcon },
];

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40';

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  rail,
  onClick,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<NavIconProps>;
  active: boolean;
  rail: boolean;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        itemBase,
        'px-2 text-sm font-medium',
        active
          ? 'bg-background-muted text-foreground'
          : 'text-foreground-muted hover:bg-background-subtle hover:text-foreground',
      )}
    >
      <Icon active={active} className={cn(active && 'text-primary')} />
      <span className={fadeLabel(rail)}>{label}</span>
    </Link>
  );
}

/** Up to two initials: "Ada Lovelace" -> "AL", "ada@x.dev" -> "A". */
function initials(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  const first = words[0] ?? 'U';
  const last = words.at(-1) ?? '';
  if (name.includes('@') || words.length < 2) return first.charAt(0).toUpperCase();
  return (first.charAt(0) + last.charAt(0)).toUpperCase();
}

function SidebarTooltip({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side="right"
        sideOffset={8}
        className={cn('shadow-none', hint && 'flex items-center gap-3')}
      >
        {label}
        {hint ? <kbd className="font-sans text-foreground-muted">{hint}</kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/*
 * Collapsing animates the sidebar's width between 240px and the 56px rail,
 * and hovering the rail expands it over the page until the pointer leaves.
 * Every row keeps its icon in a fixed 36px slot at the left, so the icons
 * hold still while the width changes and the labels fade and get clipped.
 * All of it is desktop only: below `md` the drawer is always full width.
 */
const itemBase = cn(
  'flex h-9 w-full shrink-0 items-center gap-2.5 overflow-hidden rounded-item transition-colors',
  focusRing,
);

/** Labels fade out quickly on collapse and back in once the width has grown. */
function fadeLabel(rail: boolean) {
  return cn(
    'min-w-0 whitespace-nowrap transition-opacity',
    rail ? 'duration-100 md:opacity-0' : 'delay-100 duration-200',
  );
}

const iconButton = cn(
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-item text-foreground-muted transition-colors hover:bg-background-subtle hover:text-foreground',
  focusRing,
);

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  /**
   * Desktop only: start as a 56px icon rail instead of the full sidebar (the
   * editor, which needs the width). The user can switch either way; below `md`
   * the drawer is always the full sidebar.
   */
  defaultCollapsed?: boolean;
  className?: string;
}

const COLLAPSE_EVENT = 'sovereign:sidebar-collapsed';

// Holds the choice when localStorage is blocked, so the toggle still works.
const memoryStore = new Map<string, string>();

function readStored(key: string) {
  try {
    return window.localStorage.getItem(key) ?? memoryStore.get(key) ?? null;
  } catch {
    return memoryStore.get(key) ?? null;
  }
}

function subscribeCollapsed(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(COLLAPSE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(COLLAPSE_EVENT, onChange);
  };
}

/**
 * The desktop collapsed/expanded choice, one for the whole app once the user
 * has made it. Until then each surface uses its own default (the editor starts
 * collapsed). The server render uses the default.
 */
function useCollapsed(defaultCollapsed: boolean) {
  const storageKey = 'sovereign:sidebar-collapsed';
  const stored = useSyncExternalStore(
    subscribeCollapsed,
    () => readStored(storageKey),
    () => null,
  );
  const collapsed = stored === null ? defaultCollapsed : stored === 'true';

  const toggle = useCallback(() => {
    memoryStore.set(storageKey, String(!collapsed));
    try {
      window.localStorage.setItem(storageKey, String(!collapsed));
    } catch {
      // Storage unavailable: the choice lasts until the page reloads.
    }
    window.dispatchEvent(new Event(COLLAPSE_EVENT));
  }, [storageKey, collapsed]);

  return [collapsed, toggle] as const;
}

export function Sidebar({ open, onClose, defaultCollapsed = false, className }: SidebarProps) {
  const [collapsed, toggleCollapsed] = useCollapsed(defaultCollapsed);
  // Collapsed, the rail expands over the page while the pointer or keyboard
  // focus is in it, after a short dwell so passing over it doesn't trigger it.
  const [peek, setPeek] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const hoveringRef = useRef(false);
  const peekTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const rail = collapsed && !peek;

  const schedulePeek = useCallback((next: boolean, delay: number) => {
    clearTimeout(peekTimerRef.current);
    peekTimerRef.current = setTimeout(() => setPeek(next), delay);
  }, []);
  useEffect(() => () => clearTimeout(peekTimerRef.current), []);

  const handleToggle = useCallback(() => {
    clearTimeout(peekTimerRef.current);
    setPeek(false);
    toggleCollapsed();
  }, [toggleCollapsed]);
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const user = session?.user;
  const displayName = user?.name ?? user?.email ?? 'Your account';

  // The Projects page's prompt box is the project creator: focus it in place,
  // or navigate there and let the page focus it once it mounts.
  const startNewProject = useCallback(() => {
    if (pathname === '/dashboard') {
      window.dispatchEvent(new CustomEvent('open-new-project'));
    } else {
      router.push('/dashboard?new=true');
    }
  }, [pathname, router]);

  // "N" starts a new project unless something else has the keyboard.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'n' || event.defaultPrevented || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isTypingTarget(event.target) || document.querySelector('[role="dialog"]')) return;
      event.preventDefault();
      startNewProject();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [startNewProject]);

  return (
    <>
      {open && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}
      {/* Holds the sidebar's place in the layout; the aside can expand past it. */}
      <div
        className={cn(
          'md:relative md:shrink-0 md:transition-[width] md:duration-200 md:ease-out',
          collapsed ? 'md:w-14' : 'md:w-[240px]',
        )}
      >
        <aside
          aria-label="Navigation"
          onPointerEnter={(event) => {
            if (event.pointerType !== 'mouse') return;
            hoveringRef.current = true;
            if (collapsed) schedulePeek(true, 120);
          }}
          onPointerLeave={(event) => {
            if (event.pointerType !== 'mouse') return;
            hoveringRef.current = false;
            if (!menuOpen) schedulePeek(false, 150);
          }}
          onFocus={() => {
            if (collapsed) schedulePeek(true, 0);
          }}
          onBlur={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            if (!hoveringRef.current && !menuOpen) schedulePeek(false, 0);
          }}
          className={cn(
            'fixed inset-y-0 left-0 z-50 flex w-[240px] flex-col overflow-hidden border-r border-border bg-background px-2.5 pb-3 transition-[transform,width,box-shadow] duration-200 ease-out md:absolute md:z-30 md:translate-x-0',
            open ? 'translate-x-0' : '-translate-x-full',
            rail && 'md:w-14',
            collapsed && peek && 'md:shadow-popover',
            className,
          )}
        >
          <TooltipProvider delayDuration={300}>
            {/*
             * The same offset on every page, so the sidebar never shifts when
             * you navigate. It shares a line with the Projects page title.
             */}
            <div className="mt-8 flex h-9 shrink-0 items-center lg:mt-10">
              <Link
                href="/dashboard"
                onClick={onClose}
                aria-label="Sovereign home"
                className={cn('flex h-9 min-w-0 shrink-0 items-center rounded-item', focusRing)}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center">
                  <Logo size={28} />
                </span>
                <span
                  className={cn('ml-0.5 text-base font-semibold text-foreground', fadeLabel(rail))}
                >
                  Sovereign
                </span>
              </Link>

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                className="ml-auto md:hidden"
              >
                <X className="h-4 w-4" />
              </Button>
              {/* Expanded by hover, the same button pins the sidebar open. */}
              <SidebarTooltip label={collapsed ? 'Keep sidebar open' : 'Collapse sidebar'}>
                <button
                  type="button"
                  aria-label={collapsed ? 'Keep sidebar open' : 'Collapse sidebar'}
                  onClick={handleToggle}
                  tabIndex={rail ? -1 : undefined}
                  className={cn(
                    iconButton,
                    'ml-auto hidden h-8 w-8 transition-[opacity,background-color,color] md:flex',
                    rail ? 'pointer-events-none opacity-0' : 'delay-100',
                  )}
                >
                  {collapsed ? (
                    <PanelLeft className="h-[18px] w-[18px]" strokeWidth={1.5} />
                  ) : (
                    <PanelLeftClose className="h-[18px] w-[18px]" strokeWidth={1.5} />
                  )}
                </button>
              </SidebarTooltip>
            </div>

            <SidebarTooltip label="New project" hint="N">
              <Link
                href="/dashboard?new=true"
                aria-label="New project"
                onClick={(event) => {
                  event.preventDefault();
                  onClose();
                  startNewProject();
                }}
                className={cn(
                  itemBase,
                  'mt-4 border border-border bg-background-subtle px-[7px] text-sm font-medium text-foreground-secondary hover:border-border-strong hover:bg-background-muted hover:text-foreground',
                )}
              >
                <NewProjectIcon />
                <span className={fadeLabel(rail)}>New project</span>
              </Link>
            </SidebarTooltip>

            <nav aria-label="Primary" className="mt-3 flex flex-1 flex-col gap-0.5">
              {navItems.map((item) => (
                <NavItem
                  key={item.href}
                  {...item}
                  active={
                    item.href === '/dashboard'
                      ? pathname === '/dashboard'
                      : pathname.startsWith(item.href)
                  }
                  rail={rail}
                  onClick={onClose}
                />
              ))}
            </nav>

            <div className="mt-2 border-t border-border pt-2">
              <DropdownMenu
                onOpenChange={(next) => {
                  setMenuOpen(next);
                  // Closing the menu outside the sidebar collapses it again.
                  if (!next && !hoveringRef.current) schedulePeek(false, 150);
                }}
              >
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Account menu"
                    className={cn(
                      itemBase,
                      'group h-11 px-1 text-left hover:bg-background-subtle data-[state=open]:bg-background-subtle',
                    )}
                  >
                    <Avatar className="h-7 w-7 shrink-0">
                      {user?.image ? <AvatarImage src={user.image} alt={displayName} /> : null}
                      <AvatarFallback className="bg-background-muted text-[11px] font-medium text-foreground-secondary">
                        {initials(displayName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className={cn('flex-1 leading-tight', fadeLabel(rail))}>
                      <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                      {user?.email && user.email !== displayName ? (
                        <p className="truncate text-xs text-foreground-muted">{user.email}</p>
                      ) : null}
                    </div>
                    <Ellipsis className="mr-1 h-4 w-4 shrink-0 text-foreground-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100" />
                  </button>
                </DropdownMenuTrigger>
                <AccountMenuContent
                  name={user?.name ?? 'Your account'}
                  email={user?.email ?? ''}
                  onNavigate={onClose}
                />
              </DropdownMenu>
            </div>
          </TooltipProvider>
        </aside>
      </div>
    </>
  );
}

function AccountMenuContent({
  name,
  email,
  onNavigate,
}: {
  name: string;
  email: string;
  /** Closes the mobile drawer when a link in the menu is followed. */
  onNavigate?: () => void;
}) {
  return (
    <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-[224px]">
      <DropdownMenuLabel className="px-2 py-1.5 font-normal">
        <div className="flex flex-col">
          <span className="truncate text-sm font-medium text-foreground">{name}</span>
          <span className="truncate text-xs font-normal text-foreground-muted">{email}</span>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link href="/settings" onClick={onNavigate}>
          <Settings className="text-foreground-muted" />
          Settings
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/' })}>
        <LogOut className="text-foreground-muted" />
        Sign out
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

export function SidebarToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onToggle}
      className="shrink-0"
      aria-label={open ? 'Close sidebar' : 'Open sidebar'}
    >
      {open ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
    </Button>
  );
}
