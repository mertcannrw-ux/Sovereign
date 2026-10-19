'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@app-builder/ui/utils';

// Board overhang past the frame on each side; matches `inset: -5px` on `.dot-grid-board`.
const BLEED = 5;
const SPACING = 16;
// Furthest the board leans toward the cursor, in degrees.
const MAX_TILT = 5;
// Dots are pushed away from the cursor by this fraction of their distance to
// it, fading out over PUSH_RADIUS (gaussian falloff): ~7px at the peak.
const PUSH = 0.3;
const PUSH_RADIUS = 60;
// Dots within about this radius of the cursor swell and brighten.
const LENS_RADIUS = 36;
const SPRING = 0.12;
const DAMPING = 0.78;
const HOVER_FADE_MS = 300;
// Per dot: home x, home y, offset x, offset y, velocity x, velocity y.
const STRIDE = 6;

type Rgb = [number, number, number];

function tokenColor(name: string): Rgb {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  const n = hex ? parseInt(hex, 16) : 0x808080;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const mix = (from: number, to: number, t: number) => from + (to - from) * t;

/**
 * The interactive dot grid behind a project card with nothing to preview.
 * While its `.group` card is hovered the dots turn lime, the ones near the
 * cursor are pushed away from it on springs and swell, and the board leans
 * toward the cursor (`.dot-grid-board` in globals.css). The animation loop
 * runs only while something is still moving.
 */
export function DotGrid({ className }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const card = root?.closest<HTMLElement>('.group');
    if (!root || !canvas || !ctx || !card) return;

    const gray = tokenColor('--foreground-muted');
    const lime = tokenColor('--primary');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let dots = new Float32Array(0);
    let width = 0;
    let height = 0;
    let hovered = false;
    // 0 = resting gray, 1 = fully lime; eased over HOVER_FADE_MS.
    let hover = 0;
    let cursorX = 0;
    let cursorY = 0;
    let frame = 0;
    let lastTime = 0;

    function draw() {
      ctx!.clearRect(0, 0, width, height);
      const still = reducedMotion.matches;
      const r = mix(gray[0], lime[0], hover);
      const g = mix(gray[1], lime[1], hover);
      const b = mix(gray[2], lime[2], hover);
      for (let i = 0; i < dots.length; i += STRIDE) {
        const x = dots[i]! + dots[i + 2]!;
        const y = dots[i + 1]! + dots[i + 3]!;
        const distance2 = (x - cursorX) ** 2 + (y - cursorY) ** 2;
        const lens = still ? 0 : hover * Math.exp(-distance2 / LENS_RADIUS ** 2);
        const alpha = mix(0.28, 0.55, hover) + 0.35 * lens;
        ctx!.fillStyle = `rgba(${r | 0},${g | 0},${b | 0},${alpha})`;
        ctx!.beginPath();
        ctx!.arc(x, y, 1 + lens, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    // Lay the grid over the board so a whole number of dots fits each way,
    // which keeps the outermost dots ~3px inside every edge of the frame.
    function layout() {
      width = canvas!.clientWidth;
      height = canvas!.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = Math.max(1, Math.round(width / SPACING));
      const rows = Math.max(1, Math.round(height / SPACING));
      dots = new Float32Array(cols * rows * STRIDE);
      for (let row = 0, i = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++, i += STRIDE) {
          dots[i] = (width / cols) * (col + 0.5);
          dots[i + 1] = (height / rows) * (row + 0.5);
        }
      }
      draw();
    }

    function step(now: number) {
      const dt = lastTime ? Math.min(now - lastTime, 50) : 16;
      lastTime = now;
      hover = Math.min(1, Math.max(0, hover + ((hovered ? 1 : -1) * dt) / HOVER_FADE_MS));
      const pushing = hovered && !reducedMotion.matches;
      let moving = false;
      for (let i = 0; i < dots.length; i += STRIDE) {
        let targetX = 0;
        let targetY = 0;
        if (pushing) {
          const dx = dots[i]! - cursorX;
          const dy = dots[i + 1]! - cursorY;
          const push = PUSH * Math.exp(-(dx * dx + dy * dy) / PUSH_RADIUS ** 2);
          targetX = dx * push;
          targetY = dy * push;
        }
        const vx = (dots[i + 4]! + (targetX - dots[i + 2]!) * SPRING) * DAMPING;
        const vy = (dots[i + 5]! + (targetY - dots[i + 3]!) * SPRING) * DAMPING;
        dots[i + 2]! += vx;
        dots[i + 3]! += vy;
        dots[i + 4] = vx;
        dots[i + 5] = vy;
        if (Math.abs(vx) + Math.abs(vy) + Math.abs(targetX - dots[i + 2]!) > 0.01) moving = true;
      }
      draw();
      const fading = hovered ? hover < 1 : hover > 0;
      frame = moving || fading ? requestAnimationFrame(step) : 0;
      if (!frame) lastTime = 0;
    }

    function wake() {
      if (!frame) frame = requestAnimationFrame(step);
    }

    function onMove(event: MouseEvent) {
      const rect = root!.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      cursorX = x + BLEED;
      cursorY = y + BLEED;
      // Clamped, so hovering the text below the thumbnail leans toward its bottom edge.
      const fx = Math.min(1, Math.max(0, x / rect.width));
      const fy = Math.min(1, Math.max(0, y / rect.height));
      root!.style.setProperty('--cursor-x', `${fx * 100}%`);
      root!.style.setProperty('--cursor-y', `${fy * 100}%`);
      // rotateX(+) brings the bottom edge forward; rotateY(-) brings the right edge forward.
      root!.style.setProperty('--tilt-x', `${(fy - 0.5) * 2 * MAX_TILT}deg`);
      root!.style.setProperty('--tilt-y', `${(0.5 - fx) * 2 * MAX_TILT}deg`);
      hovered = true;
      wake();
    }

    function onLeave() {
      hovered = false;
      wake();
    }

    const resizeObserver = new ResizeObserver(layout);
    resizeObserver.observe(canvas);
    card.addEventListener('mousemove', onMove);
    card.addEventListener('mouseleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      card.removeEventListener('mousemove', onMove);
      card.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      aria-hidden="true"
      className={cn('dot-grid dot-grid-glow pointer-events-none', className)}
    >
      <div className="dot-grid-board">
        <canvas ref={canvasRef} className="block h-full w-full" />
      </div>
    </div>
  );
}
