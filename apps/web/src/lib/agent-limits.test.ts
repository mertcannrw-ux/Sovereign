import { describe, expect, it } from 'vitest';
import { resolveNoProgressGuard, resolveOptionalLimit } from '@/lib/agent-limits';

describe('resolveOptionalLimit', () => {
  it('treats unset and unusable values as "no limit"', () => {
    for (const raw of [undefined, '', ' ', '0', '-5', 'abc', 'NaN', 'Infinity']) {
      expect(resolveOptionalLimit(raw), String(raw)).toBeUndefined();
    }
  });

  it('honors an explicit operator bound', () => {
    expect(resolveOptionalLimit('80')).toBe(80);
    expect(resolveOptionalLimit(' 120 ')).toBe(120);
    expect(resolveOptionalLimit('120.9')).toBe(120);
  });
});

describe('resolveNoProgressGuard', () => {
  it('is off by default so BYOK runs never end on non-mutating turns alone', () => {
    expect(resolveNoProgressGuard(undefined)).toBe(Number.POSITIVE_INFINITY);
    expect(resolveNoProgressGuard('0')).toBe(Number.POSITIVE_INFINITY);
    expect(resolveNoProgressGuard('nope')).toBe(Number.POSITIVE_INFINITY);
  });

  it('honors an operator-configured turn bound', () => {
    expect(resolveNoProgressGuard('40')).toBe(40);
  });
});
