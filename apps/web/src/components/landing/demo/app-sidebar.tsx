'use client';

import {
  Command,
  LayoutDashboard,
  LayoutTemplate,
  LogOut,
  Plus,
  Settings,
  Users,
} from 'lucide-react';
import { cn } from '@app-builder/ui/utils';

/**
 * The signed-in sidebar, rebuilt from `components/layout/sidebar.tsx`:
 * 256px, `bg-background-subtle`, the accent Command tile + uppercase
 * wordmark, a `New project` button, the `Workspace` section label, and the
 * four real nav routes. Label, icon and active treatment are the shipped ones.
 */
const NAV_ITEMS = [
  { label: 'Projects', icon: LayoutDashboard },
  { label: 'Templates', icon: LayoutTemplate },
  { label: 'Team', icon: Users },
  { label: 'Settings', icon: Settings },
];

export function AppSidebar({ active = 'Projects' }: { active?: string }) {
  return (
    <aside className="hidden w-[200px] shrink-0 flex-col border-r border-border bg-background-subtle lg:flex xl:w-[212px]">
      <div className="flex h-16 shrink-0 items-center gap-3 px-4">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-[0_0_0_1px_rgba(184,255,90,0.3)]">
          <Command className="h-4 w-4" strokeWidth={2.5} />
        </span>
        <span className="text-[13px] font-bold uppercase tracking-[0.2em] text-foreground">
          Sovereign
        </span>
      </div>

      <div className="px-3 pt-1">
        <div className="flex h-9 w-full items-center justify-start gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground">
          <Plus className="h-4 w-4" />
          New project
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-5">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-muted">
          Workspace
        </p>
        {NAV_ITEMS.map((item) => {
          const isActive = item.label === active;
          return (
            <div
              key={item.label}
              className={cn(
                'flex h-9 items-center gap-3 rounded-lg px-3 text-[13px] font-medium',
                isActive ? 'bg-background-muted text-foreground' : 'text-foreground-muted',
              )}
            >
              <item.icon className={cn('h-4 w-4 shrink-0', isActive && 'text-primary')} />
              {item.label}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-border p-3">
        <div className="flex items-center gap-2.5 rounded-xl p-1.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border bg-background-muted text-[11px] font-semibold text-foreground-secondary">
            A
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-foreground">Admin</p>
            <p className="truncate text-[10px] text-foreground-muted">admin@appbuilder.local</p>
          </div>
          <LogOut className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
        </div>
      </div>
    </aside>
  );
}
