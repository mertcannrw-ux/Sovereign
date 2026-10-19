'use client';

import { useCallback, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { cn } from '@app-builder/ui/utils';
import { Logo } from '@/components/brand/logo';
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
import {
  LayoutDashboard,
  Settings,
  Users,
  X,
  PanelLeftClose,
  PanelLeft,
  LogOut,
  Plus,
  Ellipsis,
  type LucideIcon,
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Projects', icon: LayoutDashboard },
  { href: '/dashboard/team', label: 'Team', icon: Users },
];

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40';

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-9 items-center gap-2.5 rounded-item px-2 text-sm font-medium transition-colors',
        focusRing,
        active
          ? 'bg-background-muted text-foreground'
          : 'text-foreground-muted hover:bg-background-subtle hover:text-foreground',
      )}
    >
      <Icon className={cn('h-[18px] w-[18px] shrink-0', active && 'text-primary')} />
      {label}
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

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  className?: string;
}

export function Sidebar({ open, onClose, className }: SidebarProps) {
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
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[240px] shrink-0 flex-col border-r border-border bg-background px-3 pb-3 transition-transform duration-200 md:static md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
          className,
        )}
      >
        {/* Same top offset and height as the Projects title row, so they share a line. */}
        <div className="mt-8 flex h-9 shrink-0 items-center justify-between px-2 lg:mt-10">
          <Link href="/dashboard" className={cn('rounded-item', focusRing)} onClick={onClose}>
            <Logo size="nav" />
          </Link>
          <Button variant="ghost" size="icon-sm" onClick={onClose} className="md:hidden">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <TooltipProvider delayDuration={400}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href="/dashboard?new=true"
                onClick={(event) => {
                  event.preventDefault();
                  onClose();
                  startNewProject();
                }}
                className={cn(
                  'mt-4 flex h-9 shrink-0 items-center gap-2 rounded-item border border-border bg-background-subtle px-2 text-sm font-medium text-foreground-secondary transition-colors hover:border-border-strong hover:bg-background-muted hover:text-foreground',
                  focusRing,
                )}
              >
                <Plus className="h-4 w-4 shrink-0" />
                New project
              </Link>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              sideOffset={8}
              className="flex items-center gap-3 shadow-none"
            >
              New project
              <kbd className="font-sans text-foreground-muted">N</kbd>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <nav className="mt-3 flex flex-1 flex-col gap-0.5">
          {navItems.map((item) => (
            <NavItem
              key={item.href}
              {...item}
              active={
                item.href === '/dashboard'
                  ? pathname === '/dashboard'
                  : pathname.startsWith(item.href)
              }
              onClick={onClose}
            />
          ))}
        </nav>

        <NavItem
          href="/settings"
          label="Settings"
          icon={Settings}
          active={pathname.startsWith('/settings')}
          onClick={onClose}
        />

        <div className="mt-2 border-t border-border pt-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Account menu"
                className={cn(
                  'group flex h-11 w-full items-center gap-2 rounded-item px-2 text-left transition-colors hover:bg-background-subtle data-[state=open]:bg-background-subtle',
                  focusRing,
                )}
              >
                <Avatar className="h-7 w-7">
                  {user?.image ? <AvatarImage src={user.image} alt={displayName} /> : null}
                  <AvatarFallback className="bg-background-muted text-[11px] font-medium text-foreground-secondary">
                    {initials(displayName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                  {user?.email && user.email !== displayName ? (
                    <p className="truncate text-xs text-foreground-muted">{user.email}</p>
                  ) : null}
                </div>
                <Ellipsis className="h-4 w-4 shrink-0 text-foreground-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[state=open]:opacity-100" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-[224px]">
              <DropdownMenuLabel className="px-2 py-1.5 font-normal">
                <div className="flex flex-col">
                  <span className="truncate text-sm font-medium text-foreground">
                    {user?.name ?? 'Your account'}
                  </span>
                  <span className="truncate text-xs font-normal text-foreground-muted">
                    {user?.email ?? ''}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => signOut({ callbackUrl: '/' })}>
                <LogOut className="text-foreground-muted" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
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
