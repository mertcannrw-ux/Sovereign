'use client';

import Link from 'next/link';
import { motion, useScroll, useSpring } from 'framer-motion';
import { ArrowRight, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@app-builder/ui/utils';
import { Logo } from './logo';

const NAV = [
  { href: '#product', label: 'Product' },
  { href: '#editor', label: 'Visual editor' },
  { href: '#templates', label: 'Templates' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 26, mass: 0.3 });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-colors duration-300',
        scrolled
          ? 'border-b border-white/[0.07] bg-background/80 backdrop-blur-xl'
          : 'bg-gradient-to-b from-background/85 via-background/45 to-transparent',
      )}
    >
      <div className="mx-auto flex h-[72px] max-w-[1320px] items-center justify-between px-5 sm:px-8">
        <Link href="/" aria-label="Sovereign home">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-lg px-3 py-2 text-sm text-foreground-muted transition-colors hover:bg-white/[0.04] hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/auth/signin"
            className="hidden px-3 py-2 text-sm text-foreground-muted transition-colors hover:text-foreground sm:block"
          >
            Sign in
          </Link>
          <Link
            href="/auth/signin"
            className="group hidden h-10 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.02] sm:flex"
          >
            Start building
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className="grid h-10 w-10 place-items-center rounded-lg border border-border text-foreground-secondary lg:hidden"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-white/[0.07] bg-background/95 backdrop-blur-xl lg:hidden">
          <nav className="mx-auto flex max-w-[1320px] flex-col gap-1 px-5 py-4">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm text-foreground-secondary transition-colors hover:bg-white/[0.04] hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
            <Link
              href="/auth/signin"
              onClick={() => setOpen(false)}
              className="mt-2 flex h-11 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground"
            >
              Start building
              <ArrowRight className="h-4 w-4" />
            </Link>
          </nav>
        </div>
      )}

      <motion.div
        aria-hidden
        style={{ scaleX: progress }}
        className="h-px origin-left bg-gradient-to-r from-primary via-primary to-[#8BC7FF]"
      />
    </header>
  );
}

const FOOTER_COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Workspace', href: '#product' },
      { label: 'Visual editor', href: '#editor' },
      { label: 'Templates', href: '#templates' },
      { label: 'Pricing', href: '#pricing' },
    ],
  },
  {
    title: 'Under the hood',
    links: [
      { label: 'Providers', href: '#byok' },
      { label: 'Security', href: '#security' },
      { label: 'Workflow', href: '#workflow' },
    ],
  },
  {
    title: 'Access',
    links: [
      { label: 'Sign in', href: '/auth/signin' },
      { label: 'Create account', href: '/auth/signup' },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative border-t border-white/[0.08]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent"
      />
      <div className="mx-auto max-w-[1320px] px-5 py-14 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_2fr]">
          <div>
            <Logo />
            <p className="mt-4 max-w-xs text-sm leading-6 text-foreground-muted">
              The independent AI workspace for designing, building, and shipping real software.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.title}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground-muted">
                  {column.title}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-sm text-foreground-secondary transition-colors hover:text-primary"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col justify-between gap-3 border-t border-white/10 pt-6 text-xs text-foreground-muted sm:flex-row">
          <p>© {new Date().getFullYear()} Sovereign</p>
          <p>Built for independent software.</p>
        </div>
      </div>
    </footer>
  );
}
