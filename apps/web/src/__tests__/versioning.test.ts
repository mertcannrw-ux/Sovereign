// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { computeDiff, createVersion, reconstructProjectFiles } from '@/lib/versioning';
import type { DbClient } from '@/lib/project-files';

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

describe('createVersion', () => {
  const files = [{ file: 'src/App.tsx', operation: 'create' as const, after: 'export {}' }];

  function mockDb() {
    const create = vi.fn().mockResolvedValue({ id: 'snap-1', versionNumber: 1 });
    const db = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      projectSnapshot: {
        findFirst: vi.fn().mockResolvedValue(null),
        create,
      },
    } as unknown as DbClient;
    return { db, create };
  }

  it('keeps existing 4-arg calls working without a message', async () => {
    const { db, create } = mockDb();
    await createVersion(db, 'proj-1', null, files);
    expect(create).toHaveBeenCalledWith({
      data: {
        projectId: 'proj-1',
        sourceMessageId: null,
        versionNumber: 1,
        manifest: [{ file: 'src/App.tsx', operation: 'create', after: 'export {}' }],
      },
    });
  });

  it('persists an optional snapshot message when provided', async () => {
    const { db, create } = mockDb();
    await createVersion(db, 'proj-1', 'msg-1', files, { message: 'autofix' });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourceMessageId: 'msg-1',
        message: 'autofix',
      }),
    });
  });
});
