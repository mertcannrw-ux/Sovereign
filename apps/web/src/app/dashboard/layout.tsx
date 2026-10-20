'use client';

import { useState } from 'react';
import { LogoLockup } from '@/components/Logo';
import { Sidebar, SidebarToggle } from '@/components/layout/sidebar';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Mobile header with toggle */}
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:hidden">
          <SidebarToggle open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} />
          <LogoLockup size="md" />
        </div>

        {/* Page content */}
        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
