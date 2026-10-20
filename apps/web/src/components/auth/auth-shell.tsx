import type { ReactNode } from 'react';
import Link from 'next/link';
import { cn } from '@app-builder/ui/utils';
import { LogoLockup } from '@/components/Logo';
import {
  COLUMN,
  Eyebrow,
  FrameRails,
  GUTTER,
  RuleMarks,
  secondaryButton,
} from '@/components/landing/primitives';

/** Form label, shared so every auth field reads the same. */
export const fieldLabel = 'text-sm font-medium text-foreground';

/** Inputs follow the landing control radius (8px) instead of the app's 12px. */
export const fieldInput = 'rounded-md';

/** Full-width submit. `primaryButton` has no disabled state of its own. */
export const submitButton = 'w-full disabled:pointer-events-none disabled:opacity-45';

/** Outlined OAuth control: the landing secondary button. */
export const oauthButton = cn(
  secondaryButton,
  'w-full disabled:pointer-events-none disabled:opacity-45',
);

export function FormError({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-error/40 bg-error-light px-3.5 py-3 text-sm text-error"
    >
      {children}
    </div>
  );
}

/**
 * Frame for every `/auth/*` screen. Same flat language as the marketing page
 * (design.md §7): hairline header and footer rules with registration marks,
 * frame rails on wide screens, mono labels and no decorative colour.
 */
export function AuthShell({
  eyebrow,
  title,
  copy,
  aside,
  children,
}: {
  eyebrow: string;
  title: string;
  copy?: ReactNode;
  /** Link in the header's right slot, e.g. "Create account" on sign in. */
  aside?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-background text-foreground">
      <FrameRails />

      <header className="border-b border-border">
        <div className={cn(COLUMN, GUTTER, 'flex h-14 items-center justify-between')}>
          <Link
            href="/"
            aria-label="Sovereign home"
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40"
          >
            <LogoLockup />
          </Link>
          {aside && (
            <Link
              href={aside.href}
              className="rounded-md px-3 py-1.5 text-[13px] text-foreground-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40"
            >
              {aside.label}
            </Link>
          )}
        </div>
      </header>

      <main className={cn(COLUMN, 'grid flex-1 lg:grid-cols-[1.1fr_1fr]')}>
        <section className={cn(GUTTER, 'hidden border-r border-border py-20 lg:flex lg:flex-col')}>
          <p className="max-w-md text-balance text-[clamp(2rem,3.6vw,3rem)] font-semibold leading-[1.05] tracking-[-0.035em]">
            Build with AI. <span className="text-foreground-muted">Own every line.</span>
          </p>
          <p className="mt-5 max-w-sm text-pretty text-base leading-7 text-foreground-muted">
            Your models, your credentials, and a production-ready codebase you can take anywhere.
          </p>
        </section>

        <section className={cn(GUTTER, 'flex items-center justify-center py-16 sm:py-20')}>
          <div className="w-full max-w-[400px]">
            <Eyebrow>{eyebrow}</Eyebrow>
            <h1 className="mt-6 text-balance text-[2.25rem] font-semibold leading-[1.05] tracking-[-0.035em]">
              {title}
            </h1>
            {copy ? (
              <p className="mt-4 text-pretty text-sm leading-6 text-foreground-muted">{copy}</p>
            ) : null}
            <div className="mt-10">{children}</div>
          </div>
        </section>
      </main>

      <footer className="relative border-t border-border">
        <RuleMarks />
        <div className={cn(COLUMN, GUTTER, 'py-6 font-mono text-[11px] text-foreground-muted')}>
          <p>© {new Date().getFullYear()} Sovereign</p>
        </div>
      </footer>
    </div>
  );
}

/** Centered spinner for the Suspense fallbacks of pages that read search params. */
export function AuthShellFallback() {
  return (
    <div className="grid min-h-screen place-items-center bg-background">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  );
}
