'use client';

import { AnimatePresence, motion, useInView, useReducedMotion } from 'framer-motion';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { cn } from '@app-builder/ui/utils';
import { ease } from '@/components/landing/primitives';

/** Stable no-op subscription: the only thing this store reports is "hydrated". */
const noopSubscribe = () => () => {};

/** What a scene receives on every frame of the player clock. */
export interface DemoFrame {
  /** Seconds elapsed inside the current scene. */
  t: number;
  /** 0 → 1 across the current scene. */
  p: number;
}

export interface DemoScene {
  id: string;
  /** Short label used by the transport's scene chips. */
  label: string;
  /** Length of the scene in seconds. */
  duration: number;
  /** One-line description shown in the transport while this scene plays. */
  caption: string;
  render: (frame: DemoFrame) => ReactNode;
}

interface Segment {
  scene: DemoScene;
  start: number;
  end: number;
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Clamp a scene's progress into a sub-window of the scene: `stage(p, 0.2, 0.6)`
 * is 0 before 20% of the scene has played and 1 after 60%. Shared by every
 * scripted film — it is the one timing primitive the scene scripts use.
 */
export function stage(p: number, from: number, to: number): number {
  if (to <= from) return p >= to ? 1 : 0;
  return Math.max(0, Math.min(1, (p - from) / (to - from)));
}

/**
 * A scripted, looping product film rendered entirely in React.
 *
 * There is no video file: a single `requestAnimationFrame` clock walks a list
 * of scenes and each scene re-renders itself from `t`/`p`. That is what lets
 * the demo stay pixel-accurate to the shipped UI — every label below is copied
 * from the running app rather than re-drawn from a screen recording.
 *
 * Behaviour: starts when the player scrolls into view, pauses when it leaves,
 * loops indefinitely, and honours `prefers-reduced-motion` by parking on a
 * poster frame until the viewer explicitly hits Play (design.md §5).
 */
export function DemoPlayer({
  scenes,
  label,
  className,
  posterSceneId,
  surfaceClassName,
}: {
  scenes: DemoScene[];
  label: string;
  className?: string;
  /** Frame to hold when motion is off. Defaults to the first scene. */
  posterSceneId?: string;
  /** Height, border and radius of the stage the scenes paint into. */
  surfaceClassName?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inView = useInView(containerRef, { amount: 0.3 });
  const prefersReducedMotion = useReducedMotion();
  // `useReducedMotion()` reads `matchMedia` during the first client render but
  // resolves null on the server, so deriving markup from it directly breaks
  // hydration (the transport's play/pause button). `useSyncExternalStore`
  // serves the server snapshot for the hydration render and the live client
  // snapshot afterwards, so the first render stays deterministic.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const reducedMotion = mounted && Boolean(prefersReducedMotion);
  // design.md: with `prefers-reduced-motion` set the film holds its poster
  // frame until the viewer presses Play, then behaves normally.
  const [playRequested, setPlayRequested] = useState(false);

  const segments = useMemo<Segment[]>(
    () =>
      scenes.reduce<{ list: Segment[]; cursor: number }>(
        (acc, scene) => {
          const segment = { scene, start: acc.cursor, end: acc.cursor + scene.duration };
          return { list: [...acc.list, segment], cursor: segment.end };
        },
        { list: [], cursor: 0 },
      ).list,
    [scenes],
  );

  const total = segments.length ? segments[segments.length - 1]!.end : 0;

  const posterIndex = Math.max(
    0,
    segments.findIndex((segment) => segment.scene.id === posterSceneId),
  );

  const [time, setTime] = useState(() => segments[posterIndex]?.start ?? 0);
  const [paused, setPaused] = useState(false);

  const running = inView && !paused && total > 0 && (!reducedMotion || playRequested);

  const toggle = useCallback(() => {
    // First press under reduced motion overrides the poster hold rather than
    // flipping `paused`, which would leave the film parked forever.
    if (reducedMotion && !playRequested) {
      setPlayRequested(true);
      setPaused(false);
      return;
    }
    setPaused((value) => !value);
  }, [reducedMotion, playRequested]);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = (now - last) / 1000;
      last = now;
      setTime((current) => (current + delta) % total);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, total]);

  const seek = useCallback((next: number) => setTime(((next % total) + total) % total), [total]);

  const index = useMemo(() => {
    const found = segments.findIndex((segment) => time >= segment.start && time < segment.end);
    return found === -1 ? segments.length - 1 : found;
  }, [segments, time]);

  const segment = segments[index] ?? segments[posterIndex];
  const scene = segment?.scene ?? null;
  const sceneTime = segment ? Math.min(time - segment.start, segment.scene.duration) : 0;
  const progress = scene && scene.duration > 0 ? sceneTime / scene.duration : 0;

  return (
    <div ref={containerRef} className={cn('relative', className)} aria-label={label} role="group">
      <div
        className={cn(
          'relative isolate overflow-hidden rounded-window border border-border bg-background shadow-card',
          surfaceClassName,
        )}
      >
        <AnimatePresence initial={false} mode="sync">
          <motion.div
            key={scene?.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease }}
            className="absolute inset-0"
          >
            {scene?.render({ t: sceneTime, p: progress })}
          </motion.div>
        </AnimatePresence>
      </div>

      <Transport
        segments={segments}
        index={index}
        time={time}
        total={total}
        progress={progress}
        caption={scene?.caption ?? ''}
        playing={running}
        onToggle={toggle}
        onRestart={() => seek(0)}
        onSeek={(next) => seek(next.start)}
      />
    </div>
  );
}

function Transport({
  segments,
  index,
  time,
  total,
  progress,
  caption,
  playing,
  onToggle,
  onRestart,
  onSeek,
}: {
  segments: Segment[];
  index: number;
  time: number;
  total: number;
  progress: number;
  caption: string;
  playing: boolean;
  onToggle: () => void;
  onRestart: () => void;
  onSeek: (segment: Segment) => void;
}) {
  return (
    <div className="mt-4 rounded-xl border border-border bg-background-subtle/80 p-3 backdrop-blur-xl sm:p-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button
          type="button"
          onClick={onToggle}
          aria-label={playing ? 'Pause demo' : 'Play demo'}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40"
        >
          {playing ? (
            <Pause className="h-4 w-4 fill-current" />
          ) : (
            <Play className="h-4 w-4 translate-x-px fill-current" />
          )}
        </button>
        <button
          type="button"
          onClick={onRestart}
          aria-label="Restart demo"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-background-muted text-foreground-secondary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>

        <span className="font-mono text-[11px] tabular-nums text-foreground-muted">
          {clock(time)} <span className="text-foreground-muted/50">/ {clock(total)}</span>
        </span>

        <p className="min-w-0 flex-1 truncate text-xs text-foreground-secondary">{caption}</p>
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        {segments.map((segment, i) => {
          const done = i < index;
          const isActive = i === index;
          return (
            <button
              key={segment.scene.id}
              type="button"
              onClick={() => onSeek(segment)}
              aria-label={`Jump to ${segment.scene.label}`}
              aria-current={isActive}
              title={segment.scene.label}
              className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-background-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40"
            >
              <span
                className={cn(
                  'absolute inset-y-0 left-0 rounded-full',
                  done ? 'w-full bg-primary/45' : 'w-0',
                  isActive && 'bg-primary',
                )}
                style={isActive ? { width: `${Math.max(3, progress * 100)}%` } : undefined}
              />
            </button>
          );
        })}
      </div>

      <ol className="mt-2.5 hidden flex-wrap gap-1.5 sm:flex">
        {segments.map((segment, i) => (
          <li key={segment.scene.id}>
            <button
              type="button"
              onClick={() => onSeek(segment)}
              aria-current={i === index}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/40',
                i === index
                  ? 'border-primary/40 bg-primary/[0.12] text-primary'
                  : 'border-border bg-background-muted text-foreground-muted hover:text-foreground-secondary',
              )}
            >
              {segment.scene.label}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
