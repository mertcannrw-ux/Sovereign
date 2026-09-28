'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { cn } from '@app-builder/ui/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import {
  Command,
  LayoutDashboard,
  LayoutTemplate,
  Settings,
  Users,
  X,
  PanelLeftClose,
  PanelLeft,
  LogOut,
  Plus,
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Projects', icon: LayoutDashboard },
  { href: '/dashboard/templates', label: 'Templates', icon: LayoutTemplate },
  { href: '/dashboard/team', label: 'Team', icon: Users },
  { href: '/settings', label: 'Settings', icon: Settings },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  className?: string;
}

export function Sidebar({ open, onClose, className }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const user = session?.user;

  return (
    <>
      {open && (
        <button
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-[256px] flex-col border-r border-border bg-background-subtle transition-transform duration-200 md:static md:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
          className,
        )}
      >
        <div className="flex h-20 items-center justify-between px-5">
          <Link href="/dashboard" className="group flex items-center gap-3.5" onClick={onClose}>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-md shadow-primary/20 ring-1 ring-primary/30 transition-transform duration-200 group-hover:scale-105">
              <Command className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <span className="text-base font-bold uppercase tracking-[0.22em] text-foreground transition-colors group-hover:text-primary">
              Sovereign
            </span>
          </Link>
          <Button variant="ghost" size="icon-sm" onClick={onClose} className="md:hidden">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="px-3 pt-4">
          <Button className="w-full justify-start gap-2" asChild>
            <Link
              href="/dashboard?new=true"
              onClick={() => {
                onClose();
                if (pathname === '/dashboard') {
                  window.dispatchEvent(new CustomEvent('open-new-project'));
                }
              }}
            >
              <Plus className="h-4 w-4" />
              New project
            </Link>
          </Button>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-6">
          <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-muted">
            Workspace
          </p>
          {navItems.map((item) => {
            const isActive =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  'flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-background-muted text-foreground'
                    : 'text-foreground-muted hover:bg-background-subtle hover:text-foreground',
                )}
              >
                <item.icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-3 rounded-xl p-2">
            <Avatar className="h-9 w-9 border border-border">
              {user?.image ? <AvatarImage src={user.image} alt={user?.name ?? 'User'} /> : null}
              <AvatarFallback className="bg-background-muted text-xs text-foreground-secondary">
                {(user?.name ?? user?.email ?? 'U').charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {user?.name ?? 'Your account'}
              </p>
              <p className="truncate text-xs text-foreground-muted">{user?.email ?? ''}</p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Sign out"
              onClick={() => signOut({ callbackUrl: '/' })}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
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
