import { describe, expect, it } from 'vitest';
import { reconcileOptimisticItems } from '@/lib/reconcile-optimistic-items';

describe('reconcileOptimisticItems', () => {
  it('replaces an optimistic item without duplicating items already loaded by a refresh', () => {
    const current = [
      { id: 'persisted-user', value: 'history copy' },
      { id: 'optimistic-user', value: 'optimistic copy' },
      { id: 'older', value: 'older message' },
    ];
    const completed = [
      { id: 'persisted-user', value: 'completed user' },
      { id: 'persisted-assistant', value: 'completed assistant' },
    ];

    expect(reconcileOptimisticItems(current, 'optimistic-user', completed)).toEqual([
      { id: 'older', value: 'older message' },
      ...completed,
    ]);
  });

  it('replaces an existing assistant copy when the terminal event repeats', () => {
    const completed = [
      { id: 'persisted-user', value: 'completed user' },
      { id: 'persisted-assistant', value: 'completed assistant' },
    ];

    const result = reconcileOptimisticItems(completed, 'optimistic-user', completed);
    expect(result).toEqual(completed);
    expect(new Set(result.map((item) => item.id)).size).toBe(result.length);
  });
});
