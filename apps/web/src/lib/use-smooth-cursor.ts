'use client';

import { useEffect, useRef, useState } from 'react';

export interface CursorPos {
  line: number;
  column: number;
}

export interface PreviewCursorTarget {
  x: number;
  y: number;
  label: string;
}

const TAG_LABELS: Record<string, string> = {
  header: 'Header',
  nav: 'Navigation',
  main: 'Main content',
  section: 'Section',
  article: 'Article',
  aside: 'Sidebar',
  footer: 'Footer',
  form: 'Form',
  button: 'Button',
  input: 'Input',
  textarea: 'Text area',
  img: 'Image',
  h1: 'Heading',
  h2: 'Heading',
  h3: 'Heading',
};

function targetLabel(tag: string, attributes: string): string {
  const ariaLabel = attributes.match(/\baria-label\s*=\s*["']([^"']+)["']/i)?.[1];
  if (ariaLabel) return ariaLabel;
  const id = attributes.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
  if (id) return `#${id}`;
  const className = attributes.match(/\bclass\s*=\s*["']([^"']+)["']/i)?.[1]?.split(/\s+/)[0];
  if (className) return `.${className}`;
  return TAG_LABELS[tag] ?? tag;
}

/**
 * Finds the most recently opened visual HTML element and maps its source line
 * to a stable point in the preview. This keeps the agent cursor tied to the
 * element currently streaming instead of deriving random-looking coordinates.
 */
export function getPreviewCursorTarget(content: string): PreviewCursorTarget | null {
  const candidates = [...content.matchAll(/<(header|nav|main|section|article|aside|footer|form|button|input|textarea|img|h[1-3])\b([^>]*)>/gi)];
  const match = candidates.at(-1);
  if (!match || match.index === undefined) return null;

  const tag = match[1]!.toLowerCase();
  const line = content.slice(0, match.index).split('\n').length;
  const depth = Math.max(
    0,
    (content.slice(0, match.index).match(/<(?:header|nav|main|section|article|aside|footer|form)\b/gi)?.length ?? 0) -
      (content.slice(0, match.index).match(/<\/(?:header|nav|main|section|article|aside|footer|form)>/gi)?.length ?? 0),
  );

  return {
    x: Math.min(82, 14 + depth * 9 + (line % 4) * 5),
    y: Math.min(84, 14 + (line % 13) * 5.3),
    label: `Building ${targetLabel(tag, match[2] ?? '')}`,
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Smoothly animates a cursor position from its current position to a target.
 * Decoupled from React render — runs on requestAnimationFrame.
 */
export function useSmoothCursor(target: CursorPos | null) {
  const currentPosRef = useRef<CursorPos>({ line: 1, column: 0 });
  const targetRef = useRef<CursorPos | null>(null);
  const animFrameRef = useRef<number>(0);
  const startTimeRef = useRef(0);
  const startPosRef = useRef<CursorPos>({ line: 1, column: 0 });

  // Sneak preview for instant feedback without waiting for the next RAF.
  const [displayPos, setDisplayPos] = useState<CursorPos>({ line: 1, column: 0 });
  // Separate visibility flag so the cursor can fade in/out.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    targetRef.current = target;
    if (!target) {
      setVisible(false);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    setVisible(true);

    // Compute distance for animation duration.
    const dLine = Math.abs(target.line - currentPosRef.current.line);
    const dCol = Math.abs(target.column - currentPosRef.current.column);
    const distance = Math.sqrt(dLine * dLine + dCol * dCol);
    // ~300ms base, 10ms per unit of distance, max 800ms
    const duration = Math.min(800, 300 + distance * 10);

    startPosRef.current = { ...currentPosRef.current };
    startTimeRef.current = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTimeRef.current;
      const t = Math.min(1, elapsed / duration);
      // Ease-out cubic for a natural deceleration.
      const ease = 1 - Math.pow(1 - t, 3);

      const newLine = lerp(startPosRef.current.line, target.line, ease);
      const newCol = lerp(startPosRef.current.column, target.column, ease);

      currentPosRef.current = { line: newLine, column: newCol };
      setDisplayPos({ line: newLine, column: newCol });

      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);

    // eslint-disable-next-line consistent-return
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [target?.line, target?.column]);

  return { pos: displayPos, visible };
}
