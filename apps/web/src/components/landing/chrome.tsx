'use client';

import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@app-builder/ui/utils';
import { Logo } from './logo';
import { COLUMN, GUTTER } from './primitives';

const NAV = [
  { href: '#product', label: 'Product' },
  { href: '#editor', label: 'Visual editor' },
  { href: '#templates', label: 'Templates' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

export function SiteHeader() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
      <div className={cn(COLUMN, GUTTER, 'flex h-14 items-center justify-between')}>
        <div className="flex items-center gap-10">
          <Link
            href="/"
            aria-label="Sovereign home"
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40"
          >
            <Logo />
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-1.5 text-[13px] text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40"
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/auth/signin"
            className="hidden rounded-md px-3 py-1.5 text-[13px] text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40 sm:block"
          >
            Sign in
          </Link>
          <Link
            href="/auth/signin"
            className="hidden h-8 items-center rounded-md bg-primary px-3.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:flex"
          >
            Start building
          </Link>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="mobile-nav"
            className="grid h-9 w-9 place-items-center rounded-md border border-border-strong text-foreground-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40 lg:hidden"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div id="mobile-nav" className="border-t border-border bg-background lg:hidden">
          <nav aria-label="Mobile" className={cn(COLUMN, GUTTER, 'flex flex-col py-3')}>
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="border-b border-border py-3 text-sm text-foreground-secondary transition-colors last:border-b-0 hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Link
                href="/auth/signin"
                onClick={() => setOpen(false)}
                className="flex h-10 items-center justify-center rounded-md border border-border-strong text-sm text-foreground"
              >
                Sign in
              </Link>
              <Link
                href="/auth/signin"
                onClick={() => setOpen(false)}
                className="flex h-10 items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground"
              >
                Start building
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
