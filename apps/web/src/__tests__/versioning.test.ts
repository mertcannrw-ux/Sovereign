// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import {
  computeDiff,
  createVersion,
  getVersions,
  reconstructProjectFiles,
  reconstructVersionFiles,
  restoreVersion,
  VersionNotFoundError,
} from '@/lib/versioning';
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

// ─── Fake project database ─────────────────────────────
//
// Models the two tables a restore touches so tests assert the resulting state
// (files on disk, snapshot rows) instead of individual call arguments.

interface SnapshotSeed {
  id: string;
  versionNumber: number;
  manifest: unknown;
  message?: string | null;
}

interface SnapshotRow extends Required<SnapshotSeed> {
  projectId: string;
  createdAt: Date;
}

function fakeProjectDb(seed: {
  projectId?: string;
  snapshots: SnapshotSeed[];
  files?: Map<string, string>;
}) {
  const projectId = seed.projectId ?? 'proj-1';
  const files = seed.files ?? new Map<string, string>();
  const snapshots: SnapshotRow[] = seed.snapshots.map((snapshot, index) => ({
    projectId,
    message: null,
    ...snapshot,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index, 0)),
  }));

  const db = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    // getVersions reads metadata + jsonb_array_length(manifest) in SQL; the
    // fake answers from the seeded snapshot rows directly.
    $queryRaw: vi.fn(async () =>
      [...snapshots]
        .sort((a, b) => a.versionNumber - b.versionNumber)
        .map((snapshot) => ({
          id: snapshot.id,
          versionNumber: snapshot.versionNumber,
          createdAt: snapshot.createdAt,
          message: snapshot.message,
          fileCount: Array.isArray(snapshot.manifest) ? snapshot.manifest.length : 0,
        })),
    ),
    // The real transaction boundary is a Postgres lock; the fake only has to
    // hand the same handle back so the callback's reads and writes are shared.
    $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => run(db)),
    projectSnapshot: {
      findMany: vi.fn(async ({ where }: { where?: { versionNumber?: { lte: number } } } = {}) => {
        const ceiling = where?.versionNumber?.lte;
        return snapshots
          .filter((snapshot) => ceiling === undefined || snapshot.versionNumber <= ceiling)
          .sort((a, b) => a.versionNumber - b.versionNumber);
      }),
      findFirst: vi.fn(async () => {
        const latest = [...snapshots].sort((a, b) => b.versionNumber - a.versionNumber)[0];
        return latest ? { versionNumber: latest.versionNumber } : null;
      }),
      create: vi.fn(
        async ({
          data,
        }: {
          data: { versionNumber: number; manifest: unknown; message?: string | null };
        }) => {
          snapshots.push({
            id: `snap-${data.versionNumber}`,
            projectId,
            versionNumber: data.versionNumber,
            manifest: data.manifest,
            message: data.message ?? null,
            createdAt: new Date(),
          });
          return { id: `snap-${data.versionNumber}`, versionNumber: data.versionNumber };
        },
      ),
    },
    projectFile: {
      findMany: vi.fn(async () => [...files.keys()].map((path) => ({ path }))),
      deleteMany: vi.fn(async () => {
        const count = files.size;
        files.clear();
        return { count };
      }),
      createMany: vi.fn(async ({ data }: { data: { path: string; content: string }[] }) => {
        for (const file of data) files.set(file.path, file.content);
        return { count: data.length };
      }),
    },
  } as unknown as DbClient;

  return { db, files, snapshots };
}

const RELEASE_SNAPSHOTS: SnapshotSeed[] = [
  {
    id: 'v1',
    versionNumber: 1,
    manifest: [{ file: 'index.html', operation: 'create', after: '<h1>One</h1>' }],
  },
  {
    id: 'v2',
    versionNumber: 2,
    manifest: [
      { file: 'index.html', operation: 'update', after: '<h1>Two</h1>' },
      { file: 'app.js', operation: 'create', after: 'run();' },
    ],
  },
  {
    id: 'v3',
    versionNumber: 3,
    manifest: [{ file: 'app.js', operation: 'update', after: 'run(2);' }],
  },
];

describe('reconstructVersionFiles', () => {
  it('replays every snapshot up to the requested version', async () => {
    const { db } = fakeProjectDb({ snapshots: RELEASE_SNAPSHOTS });

    await expect(reconstructVersionFiles(db, 'proj-1', 2)).resolves.toEqual([
      { path: 'index.html', content: '<h1>Two</h1>' },
      { path: 'app.js', content: 'run();' },
    ]);
  });

  it('ignores snapshots newer than the requested version', async () => {
    const { db } = fakeProjectDb({ snapshots: RELEASE_SNAPSHOTS });

    await expect(reconstructVersionFiles(db, 'proj-1', 1)).resolves.toEqual([
      { path: 'index.html', content: '<h1>One</h1>' },
    ]);
  });

  it('rejects a version the project does not have', async () => {
    const { db } = fakeProjectDb({ snapshots: RELEASE_SNAPSHOTS });

    await expect(reconstructVersionFiles(db, 'proj-1', 4)).rejects.toBeInstanceOf(
      VersionNotFoundError,
    );
  });
});

describe('restoreVersion', () => {
  it('rewrites the project files to the target version and records a restore point', async () => {
    const { db, files, snapshots } = fakeProjectDb({
      snapshots: RELEASE_SNAPSHOTS,
      files: new Map([
        ['index.html', '<h1>Two</h1>'],
        ['app.js', 'run(2);'],
        ['stale.css', 'body{}'],
      ]),
    });

    const restored = await restoreVersion(db, 'proj-1', 1);

    expect(restored).toEqual({
      id: 'snap-4',
      versionNumber: 4,
      files: [{ path: 'index.html', content: '<h1>One</h1>' }],
    });
    // Files removed after version 1 (app.js, stale.css) are gone from disk.
    expect([...files]).toEqual([['index.html', '<h1>One</h1>']]);
    expect(
      snapshots.map(({ versionNumber, message, manifest }) => ({
        versionNumber,
        message,
        manifest,
      })),
    ).toEqual([
      { versionNumber: 1, message: null, manifest: RELEASE_SNAPSHOTS[0]!.manifest },
      { versionNumber: 2, message: null, manifest: RELEASE_SNAPSHOTS[1]!.manifest },
      { versionNumber: 3, message: null, manifest: RELEASE_SNAPSHOTS[2]!.manifest },
      {
        versionNumber: 4,
        message: 'Restored version 1',
        manifest: [
          { file: 'index.html', operation: 'update', after: '<h1>One</h1>' },
          { file: 'app.js', operation: 'delete' },
          { file: 'stale.css', operation: 'delete' },
        ],
      },
    ]);
  });

  it('leaves project files untouched when the version does not exist', async () => {
    const { db, files, snapshots } = fakeProjectDb({
      snapshots: RELEASE_SNAPSHOTS,
      files: new Map([['app.js', 'run(2);']]),
    });

    await expect(restoreVersion(db, 'proj-1', 9)).rejects.toBeInstanceOf(VersionNotFoundError);
    expect([...files]).toEqual([['app.js', 'run(2);']]);
    expect(snapshots).toHaveLength(3);
  });

  it('can restore a restore point, ending in the same files', async () => {
    const { db, files, snapshots } = fakeProjectDb({
      snapshots: RELEASE_SNAPSHOTS,
      files: new Map([
        ['index.html', '<h1>Two</h1>'],
        ['app.js', 'run(2);'],
      ]),
    });

    const first = await restoreVersion(db, 'proj-1', 1);
    const second = await restoreVersion(db, 'proj-1', first.versionNumber);

    expect(second.versionNumber).toBe(5);
    expect([...files]).toEqual([['index.html', '<h1>One</h1>']]);
    expect(snapshots.at(-1)?.message).toBe('Restored version 4');
  });
});

describe('getVersions', () => {
  it('flags restore points and reports the snapshot file count', async () => {
    const { db } = fakeProjectDb({
      snapshots: [
        RELEASE_SNAPSHOTS[1]!,
        { id: 'v4', versionNumber: 4, manifest: [], message: 'Restored version 1' },
      ],
    });

    const versions = await getVersions(db, 'proj-1');

    expect(versions).toEqual([
      expect.objectContaining({ versionNumber: 2, isRestore: false, fileCount: 2, message: null }),
      expect.objectContaining({
        versionNumber: 4,
        isRestore: true,
        fileCount: 0,
        message: 'Restored version 1',
      }),
    ]);
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
