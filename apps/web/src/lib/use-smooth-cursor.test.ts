import { describe, expect, it } from 'vitest';
import { getPreviewCursorTarget } from '@/lib/use-smooth-cursor';

describe('preview cursor targeting', () => {
  it('targets the latest visual element and labels it by id', () => {
    const content = `<main>\n  <section id="hero">\n    <h1>Welcome</h1>\n  </section>\n</main>`;

    const target = getPreviewCursorTarget(content);

    expect(target).not.toBeNull();
    expect(target?.label).toBe('Building Heading');
    expect(target?.x).toBeGreaterThan(0);
    expect(target?.y).toBeGreaterThan(0);
  });

  it('moves and relabels as a new element is streamed', () => {
    const first = getPreviewCursorTarget('<main>\n<section id="hero">');
    const second = getPreviewCursorTarget(
      '<main>\n<section id="hero">\n<button aria-label="Start now">',
    );

    expect(first?.label).toBe('Building #hero');
    expect(second?.label).toBe('Building Start now');
    expect(second).not.toEqual(first);
  });

  it('returns null before a visual element is streamed', () => {
    expect(getPreviewCursorTarget('<!doctype html><html><head>')).toBeNull();
  });
});
