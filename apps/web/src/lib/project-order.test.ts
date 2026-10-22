// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PROJECT_SORT_GAP, moveProject } from './project-order';

type Row = { id: string; sortOrder: number };

/** Rows in display order: id "a" is first, "b" second, and so on. */
function rows(...sortOrders: number[]): Row[] {
  return sortOrders.map((sortOrder, index) => ({
    id: String.fromCharCode(97 + index),
    sortOrder,
  }));
}

const ids = (order: Row[]) => order.map((row) => row.id);

describe('moveProject', () => {
  it('drops between neighbours at the midpoint without touching the rest', () => {
    const { order, position } = moveProject(rows(1000, 2000, 3000), 'a', 'b', 'c');
    expect(ids(order)).toEqual(['b', 'a', 'c']);
    expect(position).toBe(2500);
  });

  it('drops after the last card', () => {
    const { order, position } = moveProject(rows(1000, 2000, 3000), 'a', 'c', null);
    expect(ids(order)).toEqual(['b', 'c', 'a']);
    expect(position).toBe(4000);
  });

  it('renumbers when equal positions leave no gap', () => {
    const { order, position } = moveProject(rows(0, 0, 0), 'a', 'b', 'c');
    expect(ids(order)).toEqual(['b', 'a', 'c']);
    expect(position).toBeNull();
  });

  it('renumbers when a card is dropped at the top, keeping new projects (0) above it', () => {
    const { order, position } = moveProject(rows(1000, 2000), 'b', null, 'a');
    expect(ids(order)).toEqual(['b', 'a']);
    expect(position).toBeNull();
    expect(PROJECT_SORT_GAP).toBeGreaterThan(0);
  });

  it('places a card before the first when there is room', () => {
    const { order, position } = moveProject(rows(2000, 3000), 'b', null, 'a');
    expect(ids(order)).toEqual(['b', 'a']);
    expect(position).toBe(1000);
  });

  it('falls back to the next neighbour when the previous one is stale', () => {
    const { order, position } = moveProject(rows(2000, 3000, 4000), 'c', 'missing', 'b');
    expect(ids(order)).toEqual(['a', 'c', 'b']);
    expect(position).toBe(2500);
  });

  it('leaves a single-card order alone', () => {
    const { order, position } = moveProject(rows(0), 'a', null, null);
    expect(ids(order)).toEqual(['a']);
    expect(position).toBe(0);
  });

  it('returns the input unchanged for an unknown moved id', () => {
    const input = rows(1000, 2000);
    const { order, position } = moveProject(input, 'missing', 'a', 'b');
    expect(order).toBe(input);
    expect(position).toBeNull();
  });
});
