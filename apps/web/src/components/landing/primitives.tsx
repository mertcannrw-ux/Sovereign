'use client';

import { motion, type Variants } from 'framer-motion';
import type { ReactNode } from 'react';
import { cn } from '@app-builder/ui/utils';

/** Shared easing — matches the one the previous landing page shipped with. */
export const ease = [0.22, 1, 0.36, 1] as const;

export const reveal: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.7, ease } },
};

export const stagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

/** Fades a block in the first time it scrolls into view. */
export function Reveal({
  children,
  className,
  delay = 0,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  as?: 'div' | 'li' | 'section';
}) {
  const Cmp = motion[as];
  return (
    <Cmp
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.7, delay, ease }}
      className={className}
    >
      {children}
    </Cmp>
  );
}

/** Container that staggers its `RevealItem` children into view. */
export function Stagger({
  children,
  className,
  step = 0.08,
}: {
  children: ReactNode;
  className?: string;
  step?: number;
}) {
  return (
    <motion.div
      variants={{ hidden: {}, visible: { transition: { staggerChildren: step } } }}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-80px' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={reveal} className={className}>
      {children}
    </motion.div>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary',
        className,
      )}
    >
      <span aria-hidden className="h-px w-6 bg-primary" />
      {children}
    </span>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  copy,
  align = 'left',
  className,
}: {
  /** Small label above the heading. Omit to render the heading on its own. */
  eyebrow?: string;
  title: ReactNode;
  copy: ReactNode;
  align?: 'left' | 'center';
  className?: string;
}) {
  return (
    <Reveal
      className={cn(
        'max-w-3xl',
        align === 'center' && 'mx-auto flex flex-col items-center text-center',
        className,
      )}
    >
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2
        className={cn(
          'text-balance text-[clamp(2.25rem,5vw,3.75rem)] font-extrabold leading-[1.03] tracking-[-0.045em] text-foreground',
          eyebrow && 'mt-6',
        )}
      >
        {title}
      </h2>
      <p className="mt-5 max-w-2xl text-balance text-base leading-7 text-foreground-muted sm:text-lg sm:leading-8">
        {copy}
      </p>
    </Reveal>
  );
}

/**
 * Accent sweep for the two words in a headline that need to feel alive.
 */
export function AccentText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'bg-gradient-to-r from-primary via-primary to-[#8BC7FF] bg-clip-text text-transparent',
        className,
      )}
    >
      {children}
    </span>
  );
}
