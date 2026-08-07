'use client';

import { useState } from 'react';
import { Sidebar, SidebarToggle } from '@/components/layout/sidebar';

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile header with toggle */}
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:hidden">
          <SidebarToggle open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-foreground">Sovereign</span>
        </div>

        <main className="flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
