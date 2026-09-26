// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// chat.ts transitively imports @/env (via @/lib/auth, @/server/rate-limit),
// which validates process.env at import time; vitest doesn't bootstrap it.
vi.mock('@/env', () => ({
  env: { NEXTAUTH_SECRET: 'a'.repeat(32), NEXTAUTH_URL: 'http://localhost:3000' },
}));
import { paginateMessages } from './chat';

type Row = { id: string; timestamp: Date };

// Newest-first, as the query orders them. Spaced 1s apart.
function rows(count: number) {
  const base = Date.parse('2024-01-01T00:00:00.000Z');
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    timestamp: new Date(base - i * 1000),
  }));
}

function decodeCursor(cursor: string | null) {
  if (cursor === null) throw new Error('unexpected null cursor');
  const parsed = JSON.parse(cursor) as { t: string; id: string };
  return { t: Date.parse(parsed.t), id: parsed.id };
}

// The compound-cursor predicate the router applies: (timestamp, id) strictly
// below the cursor in the query's (timestamp DESC, id DESC) order.
function olderThan(all: Row[], cursorTs: number, cursorId: string) {
  return all
    .filter(
      (r) =>
        r.timestamp.getTime() < cursorTs || (r.timestamp.getTime() === cursorTs && r.id < cursorId),
    )
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime() || b.id.localeCompare(a.id));
}

describe('paginateMessages', () => {
  it('returns a nextCursor naming the oldest kept row when a probe row exists', () => {
    const result = paginateMessages(rows(6), 5);
    // 6 == limit+1 → page is the newest 5, one probe row dropped.
    expect(result.page).toHaveLength(5);
    const oldestKept = result.page.at(-1)!;
    expect(decodeCursor(result.nextCursor)).toEqual({
      t: oldestKept.timestamp.getTime(),
      id: oldestKept.id,
    });
  });

  it('advances strictly past the oldest kept row (no gap, no overlap)', () => {
    const all = rows(10);
    const limit = 5;

    const first = paginateMessages(all.slice(0, limit + 1), limit);
    const c1 = decodeCursor(first.nextCursor);
    const olderFetch = olderThan(all, c1.t, c1.id).slice(0, limit + 1);
    const second = paginateMessages(olderFetch, limit);

    const combined = [...first.page, ...second.page].map((r) => r.id);
    expect(combined).toEqual(all.map((r) => r.id)); // all 10, in order, no dupes
  });

  it('reaches every row of a same-millisecond tie group across pages', () => {
    // 6 rows share one timestamp; the walk must surface all 6 despite the
    // page cut landing mid-group. Regression guard: a timestamp-only cursor
    // with `timestamp < cursor` stranded every row after the cut.
    const base = Date.parse('2024-01-01T00:00:00.000Z');
    const tie = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      timestamp: new Date(base),
    }));
    // Descending (timestamp, id) order as the query returns them.
    const all = [...tie].sort((a, b) => b.id.localeCompare(a.id));

    const seen: string[] = [];
    let remaining = all;
    let guard = 0;
    for (;;) {
      const page = paginateMessages(remaining, 3);
      seen.push(...page.page.map((r) => r.id));
      if (!page.nextCursor) break;
      const c = decodeCursor(page.nextCursor);
      remaining = olderThan(all, c.t, c.id);
      if (guard++ > 10) throw new Error('cursor walk failed to terminate');
    }
    expect(seen).toEqual(all.map((r) => r.id));
  });

  it('returns no cursor when fewer than limit+1 rows are present', () => {
    const result = paginateMessages(rows(5), 5);
    expect(result.page).toHaveLength(5);
    expect(result.nextCursor).toBeNull();
  });

  it('returns no cursor when the page is empty', () => {
    const result = paginateMessages([], 5);
    expect(result.page).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });
});
