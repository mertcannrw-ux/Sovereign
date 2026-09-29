'use client';

import { cn } from '@app-builder/ui/utils';

/**
 * The app Sovereign generates inside the preview sandbox.
 *
 * This is a *generated app*, not Sovereign chrome, so it deliberately sits on
 * its own light palette — design.md §6 sanctions literal colours for exactly
 * this mock. The `restyled` prop is the element-level edit the visual editor
 * applies in the hero demo: the same app, recoloured in place.
 */

const BARS = [34, 58, 42, 72, 49, 88, 64];

export function GeneratedApp({
  restyled = false,
  promoted = false,
  className,
}: {
  restyled?: boolean;
  /** The Typography edit from the close-up clip: larger, tighter headline. */
  promoted?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden font-sans transition-colors duration-700',
        restyled ? 'bg-[#f7f6f1] text-[#101010]' : 'bg-[#f4f1e8] text-[#24251f]',
        className,
      )}
    >
      {/* Site nav */}
      <div className="flex shrink-0 items-center justify-between border-b border-black/[0.08] px-5 py-3">
        <span className="text-[10px] font-black tracking-[0.16em]">NORTH / GRID</span>
        <div className="flex items-center gap-3.5 text-[8px] font-semibold uppercase tracking-[0.14em] opacity-45">
          <span>Overview</span>
          <span>Sites</span>
          <span>Reports</span>
        </div>
      </div>

      {/* Hero band — the element the visual editor recolours */}
      <div
        className={cn(
          'relative flex flex-1 flex-col justify-center overflow-hidden border-b px-5 py-5 transition-colors duration-700',
          restyled ? 'border-white/10 bg-[#101010] text-[#f4f4f0]' : 'border-black/[0.08]',
        )}
      >
        <p
          className={cn(
            'text-[8px] font-semibold uppercase tracking-[0.2em] transition-colors duration-700',
            restyled ? 'text-[#B8FF5A]' : 'text-[#657044]',
          )}
        >
          Live network
        </p>
        <div className="mt-2.5 flex items-end justify-between gap-4">
          <h3
            className={cn(
              'max-w-[19ch] font-bold leading-[1.05] tracking-[-0.04em] transition-all duration-700',
              promoted ? 'text-[34px] tracking-[-0.055em]' : 'text-[22px]',
              restyled ? 'text-[#f4f4f0]' : 'text-[#20211c]',
            )}
          >
            Clean energy, intelligently distributed.
          </h3>
          <div className="hidden shrink-0 text-right sm:block">
            <p
              className={cn(
                'text-[22px] font-bold tabular-nums transition-colors duration-700',
                restyled ? 'text-[#B8FF5A]' : 'text-[#20211c]',
              )}
            >
              84.2%
            </p>
            <p className="text-[8px] uppercase tracking-[0.14em] opacity-40">Grid efficiency</p>
          </div>
        </div>
        <div
          className={cn(
            'absolute -right-8 -top-10 h-32 w-32 rounded-full blur-2xl transition-opacity duration-700',
            restyled ? 'bg-[#B8FF5A]/25 opacity-100' : 'bg-[#c9d69a]/50 opacity-0',
          )}
        />
      </div>

      {/* Metric grid */}
      <div className="grid h-[132px] shrink-0 grid-cols-3 gap-px bg-black/[0.08]">
        <div className="bg-[inherit] p-4">
          <p className="text-[8px] uppercase tracking-[0.14em] opacity-40">Generation</p>
          <p
            className={cn(
              'mt-1.5 text-[19px] font-bold tabular-nums transition-colors duration-700',
              restyled ? 'text-[#101010]' : 'text-[#24251f]',
            )}
          >
            24.8<span className="text-[10px] opacity-40"> GW</span>
          </p>
          <p
            className={cn(
              'mt-3 text-[8px] font-medium transition-colors duration-700',
              restyled ? 'text-[#4E7A12]' : 'text-[#657044]',
            )}
          >
            ↑ 12.4% this month
          </p>
        </div>

        <div
          className={cn(
            'p-4 transition-colors duration-700',
            restyled ? 'bg-[#B8FF5A] text-[#10130c]' : 'bg-[#d7ff75] text-[#20211c]',
          )}
        >
          <p className="text-[8px] uppercase tracking-[0.14em] opacity-50">Carbon avoided</p>
          <p className="mt-1.5 text-[19px] font-bold tabular-nums">
            8.6<span className="text-[10px] opacity-50"> Mt</span>
          </p>
          <div className="mt-3 flex h-5 items-end gap-1">
            {BARS.map((height, index) => (
              <span
                key={`${height}-${index}`}
                className="flex-1 rounded-sm bg-black/25"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
        </div>

        <div
          className={cn(
            'flex flex-col justify-between p-4 transition-colors duration-700',
            restyled ? 'bg-[#1B1B1B] text-[#f4f4f0]' : 'bg-[#24251f] text-[#f4f4f0]',
          )}
        >
          <p className="text-[8px] uppercase tracking-[0.14em] opacity-40">Active sites</p>
          <p className="mt-1.5 text-[19px] font-bold tabular-nums">142</p>
          <p className="text-[8px] opacity-40">Across 18 regions</p>
        </div>
      </div>
    </div>
  );
}
