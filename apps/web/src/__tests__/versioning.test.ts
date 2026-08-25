// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { computeDiff, reconstructProjectFiles } from '@/lib/versioning';

describe('computeDiff', () => {
  it('returns empty string for identical inputs', () => {
    expect(computeDiff('hello', 'hello')).toBe('');
  });

  it('shows additions and removals', () => {
    const diff = computeDiff('line1\nline2', 'line1\nline3');
    expect(diff).toContain('- line2');
    expect(diff).toContain('+ line3');
  });

  it('handles empty strings', () => {
    const diff = computeDiff('', 'new content');
    expect(diff).toContain('+ new content');
  });
});

describe('reconstructProjectFiles', () => {
  it('applies creates, updates, and deletes through the target snapshot', () => {
    expect(
      reconstructProjectFiles([
        [
          { file: 'index.html', operation: 'create', after: '<h1>First</h1>' },
          { file: 'old.css', operation: 'create', after: 'body{}' },
        ],
        [
          { file: 'index.html', operation: 'update', after: '<h1>Second</h1>' },
          { file: 'old.css', operation: 'delete', before: 'body{}' },
          { file: 'app.js', operation: 'create', after: 'start();' },
        ],
      ]),
    ).toEqual([
      { path: 'index.html', content: '<h1>Second</h1>' },
      { path: 'app.js', content: 'start();' },
    ]);
  });

  it('ignores malformed manifest entries', () => {
    expect(reconstructProjectFiles([null, {}, [{ operation: 'update' }]])).toEqual([]);
  });
});
