'use client';

import { useState } from 'react';
import { LogoLockup } from '@/components/Logo';
import { Sidebar, SidebarToggle } from '@/components/layout/sidebar';

export default function ProjectLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* The editor needs the width: it starts as a 56px icon rail on desktop. */}
      <Sidebar defaultCollapsed open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile header with toggle */}
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:hidden">
          <SidebarToggle open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
          <LogoLockup size="md" />
        </div>

        <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}
