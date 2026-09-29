import { afterEach, describe, expect, it } from 'vitest';
import {
  assertPlanAllowsMaxDuration,
  resolveNoProgressGuard,
  resolveOptionalLimit,
  VERCEL_HOBBY_MAX_DURATION,
} from '@/lib/agent-limits';

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

describe('assertPlanAllowsMaxDuration', () => {
  const originalVercel = process.env.VERCEL;
  afterEach(() => {
    process.env.VERCEL = originalVercel;
  });

  it('is silent off Vercel, whatever the value', () => {
    delete process.env.VERCEL;
    expect(() => assertPlanAllowsMaxDuration(800)).not.toThrow();
  });

  it('is silent on Vercel at or below the Hobby ceiling', () => {
    process.env.VERCEL = '1';
    expect(() => assertPlanAllowsMaxDuration(VERCEL_HOBBY_MAX_DURATION)).not.toThrow();
  });

  it('throws on Vercel when the literal exceeds the Hobby ceiling', () => {
    process.env.VERCEL = '1';
    expect(() => assertPlanAllowsMaxDuration(800)).toThrowError(/Hobby/);
  });
});
