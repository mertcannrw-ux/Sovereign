'use client';

import { useState } from 'react';
import { Command } from 'lucide-react';
import { Sidebar, SidebarToggle } from '@/components/layout/sidebar';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:hidden">
          <SidebarToggle open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
              <Command className="h-4 w-4" strokeWidth={2.5} />
            </span>
            <span className="text-sm font-bold uppercase tracking-[0.2em] text-foreground">
              Sovereign
            </span>
          </div>
        </div>

        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
