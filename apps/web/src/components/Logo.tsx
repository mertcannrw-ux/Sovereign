'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@app-builder/ui/utils';

export type LogoState = 'idle' | 'working' | 'done' | 'error';

/**
 * The Sovereign "Prompt Shield" mark. The prompt (caret + cursor) is cut out
 * with a mask, so the mark is truly transparent on any background. Colour
 * comes from `currentColor` (lime by default, see `.logo` in globals.css);
 * the state classes drive the mouth mumble, the caret squint and the error
 * shake. For the character with its random blink, use `Mascot`.
 *
 * The same paths are drawn in public/favicon.svg and the app icons: keep
 * them in sync if the mark changes.
 */
export function Logo({
  size = 24,
  state = 'idle',
  className = '',
}: {
  size?: number;
  state?: LogoState;
  className?: string;
}) {
  const maskId = useId();
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role="img"
      aria-label="Sovereign"
      className={`logo logo--${state} ${className}`}
    >
      <mask id={maskId}>
        <path
          d="M6 6.5Q6 4.5 8 4.5h16q2 0 2 2V15c0 7-5 11.8-10 14C11 26.8 6 22 6 15z"
          fill="white"
        />
        <path
          className="logo-caret"
          d="M10.5 10.5l5 4-5 4"
          fill="none"
          stroke="black"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          className="logo-cursor"
          d="M18.5 18.5h3.5"
          stroke="black"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
      </mask>
      <rect width="32" height="32" fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
}

const sizes = {
  // App sidebar: bare mark, sentence-case wordmark.
  nav: { mark: 28, word: 'text-base font-semibold' },
  sm: { mark: 28, word: 'text-[13px] font-semibold uppercase tracking-[0.2em]' },
  md: { mark: 32, word: 'text-sm font-bold uppercase tracking-[0.2em]' },
} as const;

/**
 * Mark plus "Sovereign" wordmark: the marketing header, auth screens, sidebar
 * and mobile headers all render this. Always idle.
 */
export function LogoLockup({
  className,
  size = 'sm',
}: {
  className?: string;
  size?: keyof typeof sizes;
}) {
  const s = sizes[size];
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      {/* The wordmark already names it; don't announce "Sovereign" twice. */}
      <span aria-hidden className="flex shrink-0">
        <Logo size={s.mark} />
      </span>
      <span className={cn('text-foreground', s.word)}>Sovereign</span>
    </span>
  );
}

// The eye blinks at a random interval in this range, for BLINK_MS.
const BLINK_MIN_MS = 4000;
const BLINK_MAX_MS = 8000;
const BLINK_MS = 120;

/**
 * The mark as the Sovereign character: `Logo` plus a randomly timed eye blink
 * while idle or working (design.md §9.2). Decorative - pair it with text that
 * says what is going on. Use one per screen at most.
 */
export function Mascot({
  size = 24,
  state = 'idle',
  className = '',
}: {
  size?: number;
  state?: LogoState;
  className?: string;
}) {
  const [blinking, setBlinking] = useState(false);
  const canBlink = state === 'idle' || state === 'working';

  useEffect(() => {
    if (!canBlink) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = BLINK_MIN_MS + Math.random() * (BLINK_MAX_MS - BLINK_MIN_MS);
      timer = setTimeout(() => {
        setBlinking(true);
        timer = setTimeout(() => {
          setBlinking(false);
          schedule();
        }, BLINK_MS);
      }, delay);
    };
    schedule();
    return () => {
      clearTimeout(timer);
      setBlinking(false);
    };
  }, [canBlink]);

  return (
    <span aria-hidden className="inline-flex shrink-0">
      <Logo
        size={size}
        state={state}
        className={cn(blinking && canBlink && 'logo--blink', className)}
      />
    </span>
  );
}

/** How long the caret squint plays after a build finishes. */
const DONE_MS = 500;

/**
 * Logo state for a build indicator: "working" while `isGenerating`, then
 * "done" for `doneMs` when it finishes, then back to "idle".
 */
export function useLogoState(isGenerating: boolean, doneMs = DONE_MS): LogoState {
  const [done, setDone] = useState(false);
  const wasGenerating = useRef(isGenerating);

  useEffect(() => {
    const finished = wasGenerating.current && !isGenerating;
    wasGenerating.current = isGenerating;
    if (!finished) {
      setDone(false);
      return;
    }
    setDone(true);
    const timer = setTimeout(() => setDone(false), doneMs);
    return () => clearTimeout(timer);
  }, [isGenerating, doneMs]);

  if (isGenerating) return 'working';
  return done ? 'done' : 'idle';
}
