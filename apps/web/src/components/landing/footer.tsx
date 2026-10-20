import Link from 'next/link';
import { cn } from '@app-builder/ui/utils';
import { LogoLockup } from '@/components/Logo';
import { COLUMN, GUTTER, RuleMarks } from './primitives';

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
    <footer className="relative border-t border-border">
      <RuleMarks />
      <div className={cn(COLUMN, GUTTER, 'py-16')}>
        <div className="grid gap-12 lg:grid-cols-[1.4fr_2fr]">
          <div>
            <LogoLockup />
            <p className="mt-5 max-w-xs text-sm leading-6 text-foreground-muted">
              The independent AI workspace for designing, building and shipping real software.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {FOOTER_COLUMNS.map((column) => (
              <div key={column.title}>
                <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-foreground-muted">
                  {column.title}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="text-sm text-foreground-secondary transition-colors hover:text-foreground"
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

        <div className="mt-16 flex flex-col justify-between gap-3 border-t border-border pt-6 font-mono text-[11px] text-foreground-muted sm:flex-row">
          <p>© {new Date().getFullYear()} Sovereign</p>
          <p>Built for independent software.</p>
        </div>
      </div>
    </footer>
  );
}
