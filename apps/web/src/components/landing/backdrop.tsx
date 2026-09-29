'use client';

import { cn } from '@app-builder/ui/utils';

/**
 * The vibrant layer behind the marketing page.
 *
 * Five slow-drifting colour fields, a masked grid, a conic sweep that rims
 * the headline, a scanline sweep, film grain to kill gradient banding, and a
 * vignette that lands the whole thing back on the app's near-black canvas.
 *
 * Hue stops are the templates catalog's per-category accents (#B8FF5A,
 * #8BC7FF, #D6A7FF, #FFBF7A, #77E0D3) — design.md §6 sanctions that literal
 * set for art, and reusing it keeps the marketing page inside the product
 * palette instead of inventing a second one.
 */
export function Aurora({
  className,
  intensity = 1,
  grid = true,
}: {
  className?: string;
  intensity?: number;
  grid?: boolean;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'landing-grain pointer-events-none absolute inset-0 overflow-hidden',
        className,
      )}
    >
      <div
        className="animate-aurora-a absolute -left-[18%] -top-[26%] h-[900px] w-[1080px] rounded-full blur-[110px]"
        style={{
          background:
            'radial-gradient(circle, rgba(184,255,90,0.72) 0%, rgba(184,255,90,0.26) 40%, transparent 70%)',
          opacity: intensity,
        }}
      />
      <div
        className="animate-aurora-b absolute -right-[16%] -top-[18%] h-[860px] w-[1020px] rounded-full blur-[120px]"
        style={{
          background:
            'radial-gradient(circle, rgba(139,199,255,0.68) 0%, rgba(139,199,255,0.24) 40%, transparent 70%)',
          opacity: intensity,
        }}
      />
      <div
        className="animate-aurora-c absolute bottom-[-30%] left-[22%] h-[920px] w-[1180px] rounded-full blur-[140px]"
        style={{
          background:
            'radial-gradient(circle, rgba(214,167,255,0.58) 0%, rgba(255,191,122,0.34) 36%, transparent 72%)',
          opacity: intensity,
        }}
      />
      <div
        className="animate-aurora-a absolute left-[6%] top-[34%] h-[560px] w-[680px] rounded-full blur-[130px]"
        style={{
          background: 'radial-gradient(circle, rgba(119,224,211,0.34) 0%, transparent 68%)',
          opacity: intensity * 0.85,
        }}
      />

      {/* A wide spectral band behind the headline. The blobs alone are too
          diffuse to carry the top third of the page on their own. */}
      <div
        className="absolute left-1/2 top-[6%] h-[460px] w-[1700px] max-w-none -translate-x-1/2 blur-[90px]"
        style={{
          background:
            'linear-gradient(90deg, rgba(184,255,90,0.30) 0%, rgba(119,224,211,0.22) 26%, rgba(139,199,255,0.30) 52%, rgba(214,167,255,0.26) 76%, rgba(255,191,122,0.24) 100%)',
          maskImage: 'radial-gradient(ellipse 70% 100% at 50% 50%, black, transparent 78%)',
          opacity: intensity,
        }}
      />
      {/* Conic sweep: a thin spectral rim that gives the headline a halo. */}
      <div
        className="absolute left-1/2 top-[4%] h-[680px] w-[1240px] -translate-x-1/2 rounded-full opacity-45 blur-[80px]"
        style={{
          background:
            'conic-gradient(from 180deg at 50% 50%, transparent 0deg, rgba(184,255,90,0.7) 70deg, transparent 150deg, rgba(139,199,255,0.6) 240deg, transparent 320deg)',
        }}
      />

      {/* Grid, masked so it dissolves instead of ending on a hard edge. */}
      {grid && (
        <div
          className="landing-grid absolute inset-0"
          style={{
            maskImage: 'radial-gradient(ellipse 92% 62% at 50% 28%, black, transparent 78%)',
          }}
        />
      )}

      {/* A single slow horizontal light bar, the way a lens flare drifts. */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="animate-sweep absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-primary/[0.07] to-transparent" />
      </div>

      {/* Vignette back down to the app background. The falloff is generous on
          purpose: a tight one kills the colour fields before they reach the
          headline and the page reads as a black rectangle with one lit corner. */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_125%_90%_at_50%_8%,transparent_0%,rgba(9,9,9,0.25)_54%,rgba(9,9,9,0.7)_84%,var(--background)_100%)]" />
    </div>
  );
}
