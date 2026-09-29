import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@app-builder/ui/utils';
import type { TemplateLayout } from '@/data/templates';

/**
 * Recognizable pattern sketches. Colours are the sanctioned per-category
 * palette passed in from the templates page — not app chrome.
 */
export function TemplateSketch({
  layout,
  accent,
  surface,
  className,
}: {
  layout: TemplateLayout;
  accent: string;
  surface: string;
  className?: string;
}) {
  const Layout = layouts[layout];
  return (
    <div
      aria-hidden="true"
      className={cn('relative overflow-hidden', className)}
      style={{ backgroundColor: surface, color: accent }}
    >
      <div className="absolute inset-0 p-3">
        <Layout />
      </div>
    </div>
  );
}

function Panel({
  className,
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div className={cn('rounded-md bg-white/10', className)} style={style}>
      {children}
    </div>
  );
}

function Line({ className, accent = false }: { className?: string; accent?: boolean }) {
  return (
    <span
      className={cn('block h-1.5 rounded-full bg-white/20', className)}
      style={accent ? { backgroundColor: 'currentColor' } : undefined}
    />
  );
}

function Pipeline() {
  const cards = [2, 1, 3, 1];
  return (
    <div className="grid h-full grid-cols-4 gap-1.5">
      {cards.map((count, column) => (
        <div key={column} className="flex min-h-0 flex-col gap-1.5">
          <Line className="w-2/3 shrink-0" accent={column === 0} />
          {Array.from({ length: count }, (_, card) => (
            <Panel key={card} className="min-h-0 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

function Kanban() {
  return (
    <div className="grid h-full grid-cols-3 gap-1.5">
      {[3, 2, 1].map((count, column) => (
        <div
          key={column}
          className="flex min-h-0 flex-col gap-1.5 rounded-md bg-white/[0.04] p-1.5"
        >
          <Line className="w-1/2 shrink-0" accent={column === 1} />
          {Array.from({ length: count }, (_, card) => (
            <Panel key={card} className={card === 0 ? 'h-1/3' : 'min-h-0 flex-1'} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Checklist() {
  return (
    <div className="flex h-full flex-col justify-between gap-1.5">
      {Array.from({ length: 5 }, (_, row) => (
        <div key={row} className="flex min-h-0 flex-1 items-center gap-2">
          <span
            className="h-3 w-3 shrink-0 rounded-full border border-white/25"
            style={
              row < 2 ? { backgroundColor: 'currentColor', borderColor: 'currentColor' } : undefined
            }
          />
          <Line className={row === 3 ? 'w-1/2' : 'w-4/5'} />
        </div>
      ))}
    </div>
  );
}

function Catalog() {
  return (
    <div className="grid h-full grid-cols-2 grid-rows-2 gap-1.5">
      {Array.from({ length: 4 }, (_, tile) => (
        <Panel key={tile} className="flex flex-col justify-end p-1.5">
          <Line className="w-2/3" accent={tile === 0} />
        </Panel>
      ))}
    </div>
  );
}

function Steps() {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-1">
        {Array.from({ length: 4 }, (_, step) => (
          <span key={step} className="flex flex-1 items-center gap-1">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full bg-white/20"
              style={step < 2 ? { backgroundColor: 'currentColor' } : undefined}
            />
            {step < 3 ? <span className="h-px flex-1 bg-white/20" /> : null}
          </span>
        ))}
      </div>
      <Panel className="min-h-0 flex-1 p-2">
        <div className="flex h-full flex-col justify-center gap-2">
          <Line className="w-1/3" accent />
          <Line className="w-full" />
          <Line className="w-5/6" />
          <Line className="w-2/3" />
        </div>
      </Panel>
    </div>
  );
}

function Table() {
  return (
    <div className="flex h-full flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Line className="w-1/4" accent />
        <Line className="w-1/5" />
        <Line className="ml-auto w-10" />
      </div>
      {Array.from({ length: 4 }, (_, row) => (
        <Panel key={row} className="flex min-h-0 flex-1 items-center gap-2 px-2">
          <Line className="w-1/3" />
          <Line className="w-1/5" />
          <span
            className="ml-auto h-2 w-8 rounded-full bg-white/20"
            style={row === 1 ? { backgroundColor: 'currentColor' } : undefined}
          />
        </Panel>
      ))}
    </div>
  );
}

function Admin() {
  return (
    <div className="flex h-full gap-1.5">
      <Panel className="flex w-[22%] flex-col gap-1.5 p-1.5">
        <Line accent />
        <Line />
        <Line className="w-2/3" />
      </Panel>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="grid h-1/4 grid-cols-3 gap-1.5">
          <Panel />
          <Panel />
          <Panel style={{ backgroundColor: 'currentColor', opacity: 0.35 }} />
        </div>
        <Panel className="flex min-h-0 flex-1 items-end gap-1 p-2">
          {[40, 65, 45, 80, 55, 90].map((height, bar) => (
            <span
              key={bar}
              className="flex-1 rounded-sm bg-white/20"
              style={{
                height: `${height}%`,
                ...(bar === 5 ? { backgroundColor: 'currentColor' } : {}),
              }}
            />
          ))}
        </Panel>
      </div>
    </div>
  );
}

function Billing() {
  return (
    <div className="flex h-full gap-1.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {Array.from({ length: 4 }, (_, row) => (
          <Panel key={row} className="flex min-h-0 flex-1 items-center px-2">
            <Line className={row % 2 ? 'w-1/2' : 'w-2/3'} />
          </Panel>
        ))}
      </div>
      <Panel className="flex w-[38%] flex-col justify-between p-2 ring-1 ring-current">
        <Line className="w-2/3" accent />
        <Line />
        <span className="h-3 w-full rounded-full bg-current" />
      </Panel>
    </div>
  );
}

function Settings() {
  return (
    <div className="flex h-full flex-col justify-between gap-1.5">
      {Array.from({ length: 4 }, (_, row) => (
        <Panel key={row} className="flex min-h-0 flex-1 items-center justify-between px-2">
          <Line className="w-1/3" />
          <span
            className="h-3 w-7 rounded-full bg-white/20 p-0.5"
            style={row === 1 ? { backgroundColor: 'currentColor' } : undefined}
          >
            <span
              className={cn('block h-2 w-2 rounded-full bg-white/70', row === 1 && 'ml-auto')}
            />
          </span>
        </Panel>
      ))}
    </div>
  );
}

function Blog() {
  return (
    <div className="flex h-full flex-col gap-1.5">
      <Panel className="flex h-[42%] flex-col justify-end p-2">
        <Line className="w-1/2" accent />
        <Line className="mt-1.5 w-4/5" />
      </Panel>
      {Array.from({ length: 3 }, (_, row) => (
        <div key={row} className="flex min-h-0 flex-1 items-center gap-1.5">
          <Panel className="h-full w-8 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1">
            <Line className="w-3/4" />
            <Line className="w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Mosaic() {
  return (
    <div className="grid h-full grid-cols-4 grid-rows-3 gap-1.5">
      <Panel className="col-span-2 row-span-2" />
      <Panel className="col-span-2" />
      <Panel style={{ backgroundColor: 'currentColor', opacity: 0.4 }} />
      <Panel />
      <Panel className="col-span-2" />
      <Panel />
    </div>
  );
}

function Landing() {
  return (
    <div className="flex h-full flex-col items-center justify-between py-1">
      <div className="flex w-full flex-col items-center gap-1.5">
        <Line className="w-1/2" accent />
        <Line className="w-4/5" />
        <Line className="w-2/3" />
      </div>
      <div className="grid w-full grid-cols-3 gap-1.5">
        <Panel className="h-8" />
        <Panel className="h-8" />
        <Panel className="h-8" />
      </div>
      <span className="h-3 w-16 rounded-full bg-current" />
    </div>
  );
}

function People() {
  return (
    <div className="flex h-full flex-col gap-1.5">
      <Panel className="flex h-6 shrink-0 items-center px-2">
        <Line className="w-1/3" />
      </Panel>
      {Array.from({ length: 4 }, (_, row) => (
        <div key={row} className="flex min-h-0 flex-1 items-center gap-2">
          <span className="h-4 w-4 shrink-0 rounded-full bg-white/20" />
          <Line className={row === 2 ? 'w-1/3' : 'w-1/2'} accent={row === 0} />
        </div>
      ))}
    </div>
  );
}

function Stock() {
  const levels = [80, 55, 22, 70];
  return (
    <div className="flex h-full flex-col justify-between gap-2">
      {levels.map((level, row) => (
        <div key={row} className="flex min-h-0 flex-1 items-center gap-2">
          <Line className="w-1/4 shrink-0" />
          <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-white/10">
            <span
              className="block h-full rounded-full bg-white/25"
              style={{
                width: `${level}%`,
                ...(level < 30 ? { backgroundColor: 'currentColor' } : {}),
              }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}

function Flow() {
  return (
    <div className="flex h-full gap-2">
      <div className="flex w-3 flex-col items-center">
        <span className="h-2.5 w-2.5 rounded-full bg-current" />
        <span className="w-px flex-1 bg-white/20" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/30" />
        <span className="w-px flex-1 bg-white/20" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/30" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-between gap-1.5 py-0.5">
        <Panel className="h-[28%]" />
        <Panel className="h-[28%] ring-1 ring-current" />
        <Panel className="h-[28%]" />
      </div>
    </div>
  );
}

function Chart() {
  const bars = [35, 55, 40, 70, 48, 88];
  return (
    <div className="flex h-full flex-col">
      <Line className="mb-2 w-1/3" accent />
      <div className="flex min-h-0 flex-1 items-end gap-1.5">
        {bars.map((height, bar) => (
          <span
            key={bar}
            className="flex-1 rounded-sm bg-white/20"
            style={{
              height: `${height}%`,
              ...(bar === bars.length - 1 ? { backgroundColor: 'currentColor' } : {}),
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Week() {
  return (
    <div className="grid h-full grid-cols-7 gap-1">
      {Array.from({ length: 7 }, (_, day) => (
        <div key={day} className="flex flex-col gap-1">
          <span className="h-1 rounded-full bg-white/25" />
          <Panel
            className={day === 2 ? 'h-1/3' : 'h-1/4'}
            style={day === 2 ? { backgroundColor: 'currentColor', opacity: 0.45 } : undefined}
          />
          <Panel className="min-h-0 flex-1" />
        </div>
      ))}
    </div>
  );
}

function Streaks() {
  return (
    <div className="flex h-full flex-col justify-between">
      <Line className="w-1/3" accent />
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 28 }, (_, day) => {
          const marked = day % 7 !== 5 && day > 6 && day < 24;
          return (
            <span
              key={day}
              className="aspect-square rounded-full bg-white/15"
              style={marked ? { backgroundColor: 'currentColor' } : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

function Lessons() {
  return (
    <div className="flex h-full flex-col gap-1.5">
      <span className="h-1.5 overflow-hidden rounded-full bg-white/15">
        <span className="block h-full w-2/5 bg-current" />
      </span>
      {Array.from({ length: 4 }, (_, row) => (
        <Panel key={row} className="flex min-h-0 flex-1 items-center gap-2 px-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm bg-white/25"
            style={row === 1 ? { backgroundColor: 'currentColor' } : undefined}
          />
          <Line className={row === 3 ? 'w-1/2' : 'w-3/4'} />
        </Panel>
      ))}
    </div>
  );
}

function Quiz() {
  return (
    <div className="flex h-full flex-col gap-1.5">
      <Line className="w-4/5" accent />
      <Line className="mb-1 w-1/2" />
      {Array.from({ length: 3 }, (_, option) => (
        <Panel
          key={option}
          className={cn('min-h-0 flex-1', option === 1 && 'ring-1 ring-current')}
        />
      ))}
    </div>
  );
}

function Portal() {
  return (
    <div className="flex h-full gap-1.5">
      <div className="grid w-[46%] grid-cols-4 grid-rows-4 gap-1">
        {Array.from({ length: 16 }, (_, cell) => (
          <span
            key={cell}
            className="rounded-sm bg-white/15"
            style={cell === 6 || cell === 10 ? { backgroundColor: 'currentColor' } : undefined}
          />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {Array.from({ length: 4 }, (_, row) => (
          <Panel key={row} className="flex min-h-0 flex-1 items-center px-1.5">
            <Line className={row === 0 ? 'w-2/3' : 'w-1/2'} accent={row === 0} />
          </Panel>
        ))}
      </div>
    </div>
  );
}

const layouts: Record<TemplateLayout, () => ReactNode> = {
  pipeline: Pipeline,
  kanban: Kanban,
  checklist: Checklist,
  catalog: Catalog,
  steps: Steps,
  table: Table,
  admin: Admin,
  billing: Billing,
  settings: Settings,
  blog: Blog,
  mosaic: Mosaic,
  landing: Landing,
  people: People,
  stock: Stock,
  flow: Flow,
  chart: Chart,
  week: Week,
  streaks: Streaks,
  lessons: Lessons,
  quiz: Quiz,
  portal: Portal,
};
