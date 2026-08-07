import { describe, it, expect } from 'vitest';
import { cn } from '@app-builder/ui/utils';

describe('cn (className merge)', () => {
  it('merges class names', () => {
    const result = cn('foo', 'bar');
    expect(result).toBe('foo bar');
  });

  it('deduplicates Tailwind classes', () => {
    const result = cn('p-2 p-4', 'p-4');
    expect(result).toBe('p-4');
  });

  it('handles conditional classes', () => {
    const result = cn('base', false && 'hidden', 'extra');
    expect(result).toContain('base');
    expect(result).not.toContain('hidden');
    expect(result).toContain('extra');
  });
});
