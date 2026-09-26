import { Prisma } from '@prisma-generated/prisma/client';
import { createHash } from 'node:crypto';
import type { DbClient } from '@/lib/project-files';

// ─── Types ─────────────────────────────────────────────

export interface VersionDiffEntry {
  file: string;
  operation: 'create' | 'update' | 'delete' | 'restore';
  before?: string;
  after?: string;
}

/** Marker written to `message` on snapshots created by {@link restoreVersion}. */
export const RESTORE_VERSION_MESSAGE_PREFIX = 'Restored version ';

/** Snapshot metadata for the version timeline. Deliberately excludes manifests. */
export interface VersionSummary {
  id: string;
  versionNumber: number;
  createdAt: Date;
  /** Snapshot message; restore points carry "Restored version N". */
  message: string | null;
  isRestore: boolean;
  /** Number of file operations recorded in the snapshot. */
  fileCount: number;
}

export interface RestoredProjectFile {
  path: string;
  content: string;
}

/** Raised when a version number does not exist for the project. */
export class VersionNotFoundError extends Error {
  constructor(
    readonly projectId: string,
    readonly versionNumber: number,
  ) {
    super(`Version ${versionNumber} not found for this project`);
    this.name = 'VersionNotFoundError';
  }
}

/** Reconstruct the complete filesystem by applying snapshots in chronological order. */
export function reconstructProjectFiles(manifests: unknown[]): RestoredProjectFile[] {
  const files = new Map<string, string>();
  for (const manifest of manifests) {
    if (!Array.isArray(manifest)) continue;
    for (const rawEntry of manifest) {
      if (typeof rawEntry !== 'object' || rawEntry === null) continue;
      const entry = rawEntry as Record<string, unknown>;
      if (typeof entry.file !== 'string') continue;
      if (entry.operation === 'delete') {
        files.delete(entry.file);
      } else if (typeof entry.after === 'string') {
        files.set(entry.file, entry.after);
      }
    }
  }
  return [...files].map(([path, content]) => ({ path, content }));
}

// ─── Diff Utilities ────────────────────────────────────

/**
 * Compute a simple line diff between two strings.
 * Returns a string in unified-diff-like format:
 *   `- line` for removals, `+ line` for additions.
 */
export function computeDiff(before: string, after: string): string {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const lines: string[] = [];
  const maxLen = Math.max(beforeLines.length, afterLines.length);

  for (let i = 0; i < maxLen; i++) {
    if (i >= beforeLines.length) {
      lines.push(`+ ${afterLines[i]}`);
    } else if (i >= afterLines.length) {
      lines.push(`- ${beforeLines[i]}`);
    } else if (beforeLines[i] !== afterLines[i]) {
      lines.push(`- ${beforeLines[i]}`);
      lines.push(`+ ${afterLines[i]}`);
    }
  }

  return lines.join('\n');
}

// ─── Version CRUD ──────────────────────────────────────

/**
 * Hash a project ID string to a BigInt for use as a Postgres advisory lock
 * key. Uses a simple FNV-like hash folded to a positive signed-64-bit value.
 */
function projectIdToAdvisoryKey(projectId: string): bigint {
  const factor = BigInt(31);
  const mask = BigInt('0x7fffffffffffffff');
  let hash = BigInt(0);
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash * factor + BigInt(projectId.charCodeAt(i))) & mask;
  }
  return hash;
}

/**
 * Create a project snapshot for a project, associating it with a source message
 * and the set of file diffs that resulted from that message.
 *
 * @returns The new snapshot id and its version number.
 */
export async function createVersion(
  db: DbClient,
  projectId: string,
  sourceMessageId: string | null,
  files: VersionDiffEntry[],
  options?: { message?: string },
): Promise<{ id: string; versionNumber: number }> {
  const manifest = files.map((f) => ({
    file: f.file,
    operation: f.operation,
    ...(f.before !== undefined ? { before: f.before } : {}),
    ...(f.after !== undefined ? { after: f.after } : {}),
  }));

  // Acquire a transaction-scoped advisory lock keyed on the project so that
  // concurrent version allocations serialize. This replaces the previous P2002
  // retry loop, which could not work inside an aborted Postgres transaction
  // (the unique violation poisons the transaction, making the retry's
  // findFirst fail immediately).
  const lockKey = projectIdToAdvisoryKey(projectId);
  await db.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

  const latestVersion = await db.projectSnapshot.findFirst({
    where: { projectId },
    orderBy: { versionNumber: 'desc' },
    select: { versionNumber: true },
  });
  const versionNumber = (latestVersion?.versionNumber ?? 0) + 1;

  const version = await db.projectSnapshot.create({
    data: {
      projectId,
      sourceMessageId,
      versionNumber,
      manifest,
      ...(options?.message !== undefined ? { message: options.message } : {}),
    },
  });

  return { id: version.id, versionNumber: version.versionNumber };
}

/**
 * Get the full version timeline for a project, ordered chronologically.
 */
/** A generation lease whose last heartbeat is older than this is treated as abandoned. */
export const GENERATION_LEASE_STALE_MS = 20 * 60 * 1000;

export async function tryClaimGenerationLease(
  db: DbClient,
  projectId: string,
  leaseToken: string,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - GENERATION_LEASE_STALE_MS);
  const lease = await db.project.updateMany({
    where: {
      id: projectId,
      OR: [{ generationStartedAt: null }, { generationStartedAt: { lt: cutoff } }],
    },
    data: { generationStartedAt: new Date(), generationLeaseToken: leaseToken },
  });
  return lease.count > 0;
}

/**
 * Extend the lease owned by `leaseToken`, returning false when this run no
 * longer holds it. Called once per agent iteration: a run that keeps making
 * progress keeps its lease past the stale cutoff, while a crashed or hung run
 * stops renewing and becomes reclaimable.
 */
export async function renewGenerationLease(
  db: DbClient,
  projectId: string,
  leaseToken: string,
): Promise<boolean> {
  const renewed = await db.project.updateMany({
    where: { id: projectId, generationLeaseToken: leaseToken },
    data: { generationStartedAt: new Date() },
  });
  return renewed.count > 0;
}

/**
 * Release the lease, but only while this run still owns it: a run that was
 * reclaimed after aging out must not free the lease of the run that replaced
 * it (which would let a third run start on top of live writes).
 */
export async function clearGenerationLease(
  db: DbClient,
  projectId: string,
  leaseToken: string,
): Promise<boolean> {
  const cleared = await db.project.updateMany({
    where: { id: projectId, generationLeaseToken: leaseToken },
    data: { generationStartedAt: null, generationLeaseToken: null },
  });
  return cleared.count > 0;
}

/**
 * Assert inside a file-write transaction that this run still owns the
 * generation lease. Renewal happens at iteration boundaries; between renewals
 * a run that stalled past the stale cutoff can be reclaimed and replaced. A
 * predicate on every write tx closes that gap: the replaced run's writes
 * match zero rows and the tx aborts before any file/version row lands,
 * instead of interleaving with the new run's tree.
 *
 * A plain count would still leave a TOCTOU window: a stale-lease takeover
 * (`tryClaimGenerationLease`'s updateMany) could commit between the count and
 * this tx's writes, letting the old run clobber the new owner. Locking the
 * project row FOR UPDATE blocks the takeover's updateMany until this tx
 * commits, so the ownership check holds for the whole write.
 *
 * Returns false when ownership was lost; callers must abort the run without
 * writing.
 */
export async function assertGenerationLeaseOwned(
  tx: DbClient,
  projectId: string,
  leaseToken: string,
): Promise<boolean> {
  // Row lock first: a concurrent claim blocks here until this tx ends.
  const rows = await tx.$queryRaw<{ owns_lease: boolean }[]>`
    SELECT generation_lease_token = ${leaseToken} AS owns_lease
    FROM projects WHERE id = ${projectId} FOR UPDATE`;
  return rows.length === 1 && rows[0]?.owns_lease === true;
}

export async function getVersions(db: DbClient, projectId: string): Promise<VersionSummary[]> {
  // Manifests carry full before/after file bodies; the timeline needs only
  // their entry count. Fetching the column ships every file body of every
  // snapshot on each project page load, so select the metadata and compute
  // the count in SQL (jsonb_array_length on the array) instead.
  const rows = await db.$queryRaw<
    {
      id: string;
      versionNumber: number;
      createdAt: Date;
      message: string | null;
      fileCount: number;
    }[]
  >(
    Prisma.sql`SELECT id, version_number AS "versionNumber", created_at AS "createdAt",
               message,
               COALESCE(CASE WHEN jsonb_typeof(manifest) = 'array'
                             THEN jsonb_array_length(manifest) ELSE 0 END, 0) AS "fileCount"
               FROM project_snapshots WHERE project_id = ${projectId}
               ORDER BY version_number ASC`,
  );

  return rows.map((v) => ({
    id: v.id,
    versionNumber: v.versionNumber,
    createdAt: v.createdAt,
    message: v.message,
    isRestore: v.message?.startsWith(RESTORE_VERSION_MESSAGE_PREFIX) ?? false,
    fileCount: Number(v.fileCount),
  }));
}

/**
 * Reconstruct the complete filesystem as of `versionNumber` by replaying every
 * snapshot up to and including it. This is exactly what a restore applies, so
 * the timeline can show a version before the user commits to it.
 */
export async function reconstructVersionFiles(
  db: DbClient,
  projectId: string,
  versionNumber: number,
): Promise<RestoredProjectFile[]> {
  const snapshots = await db.projectSnapshot.findMany({
    where: { projectId, versionNumber: { lte: versionNumber } },
    orderBy: { versionNumber: 'asc' },
    select: { versionNumber: true, manifest: true },
  });
  if (!snapshots.some((snapshot) => snapshot.versionNumber === versionNumber)) {
    throw new VersionNotFoundError(projectId, versionNumber);
  }

  return reconstructProjectFiles(snapshots.map((snapshot) => snapshot.manifest));
}

/**
 * Restore a project to a specific version by recording a restore event.
 * Creates a new version entry that documents the rollback.
 *
 * Reads and writes run in one transaction under the project's advisory lock so
 * a concurrent generation cannot interleave between the reconstruction and the
 * file rewrite, and so two restores cannot allocate the same version number.
 */
export async function restoreVersion(
  db: DbClient,
  projectId: string,
  versionNumber: number,
): Promise<{ id: string; versionNumber: number; files: RestoredProjectFile[] }> {
  const lockKey = projectIdToAdvisoryKey(projectId);

  // Replay reads every snapshot manifest and rewrites the whole tree; the 5s
  // interactive default aborts legitimate restores on projects with long
  // histories, so budget generously.
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

      const files = await reconstructVersionFiles(tx, projectId, versionNumber);
      const currentFiles = await tx.projectFile.findMany({
        where: { projectId },
        select: { path: true },
      });
      const restoredPaths = new Set(files.map((file) => file.path));
      const manifest = [
        ...files.map((file) => ({
          file: file.path,
          operation: 'update' as const,
          after: file.content,
        })),
        ...currentFiles
          .filter((file) => !restoredPaths.has(file.path))
          .map((file) => ({ file: file.path, operation: 'delete' as const })),
      ];

      await tx.projectFile.deleteMany({ where: { projectId } });
      if (files.length > 0) {
        await tx.projectFile.createMany({
          data: files.map((file) => ({
            projectId,
            path: file.path,
            content: file.content,
            contentHash: createHash('sha256').update(file.content).digest('hex'),
          })),
        });
      }

      const latestVersion = await tx.projectSnapshot.findFirst({
        where: { projectId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const newVersionNumber = (latestVersion?.versionNumber ?? 0) + 1;
      const version = await tx.projectSnapshot.create({
        data: {
          projectId,
          versionNumber: newVersionNumber,
          manifest: manifest as Prisma.InputJsonValue,
          sourceMessageId: null,
          createdById: null,
          message: `${RESTORE_VERSION_MESSAGE_PREFIX}${versionNumber}`,
        },
      });

      return { id: version.id, versionNumber: version.versionNumber, files };
    },
    { timeout: 30_000 },
  );
}

// ─── AI Response Parsing ───────────────────────────────

/**
 * Parse an AI response string and extract file diffs from markdown code blocks.
 *
 * Heuristic: each ```lang block whose opening fence line or first comment line
 * contains a file-like path (e.g. `// components/Foo.tsx`) is treated as a
 * file operation. Blocks without a clear path are ignored.
 */
export function parseFileDiffsFromResponse(content: string): VersionDiffEntry[] {
  const files: VersionDiffEntry[] = [];
  const codeBlockRegex = /```(\w*)\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const [, lang, code] = match;
    if (!code) continue;
    const lines = code.split('\n');
    if (lines.length === 0) continue;

    // Attempt to extract a file path from the first line if it looks like a
    // comment:
    //   // components/Foo.tsx
    //   # path/to/file.py
    //   -- path/to/file.sql
    const firstLine = lines[0]!.trim();
    const commentMatch = firstLine.match(/^\/\/\s*(.+\.\w+)\s*$/);
    const hashCommentMatch = firstLine.match(/^#\s*(.+\.\w+)\s*$/);
    const filePath = commentMatch?.[1] ?? hashCommentMatch?.[1];

    // Also consider the language tag as a hint when the code block appears
    // after a sentence referencing a file (simplified heuristic).
    const effectivePath = filePath ?? inferFilePathFromContext(content, match.index, lang || '');

    if (!effectivePath) continue;

    // If the first line was parsed as a comment, remove it from the "after"
    // content so the file content is clean.
    const hasCommentPrefix = commentMatch !== null || hashCommentMatch !== null;
    const after = hasCommentPrefix ? lines.slice(1).join('\n').trim() : code.trim();

    files.push({
      file: effectivePath,
      operation: 'update',
      after,
    });
  }

  return files;
}

/**
 * Best-effort inference of a file path from the surrounding context of a code
 * block and its language tag.
 */
function inferFilePathFromContext(
  fullContent: string,
  codeBlockIndex: number,
  lang: string,
): string | null {
  // Look backwards from the code block for a line mentioning a file path.
  const before = fullContent.slice(0, codeBlockIndex);
  const lines = before.split('\n');
  const lastLines = lines.slice(-5).reverse();

  for (const line of lastLines) {
    const fileMatch = line.match(
      /(?:file|create|update|modify|edit|src|app)\s*[`'":]\s*([\/\w.-]+\.[a-z]+)/i,
    );
    if (fileMatch) return fileMatch[1]!;

    // e.g. "components/TodoList.tsx" or "src/app/layout.tsx" on its own
    const pathMatch = line.match(/([\w.-]+\/[\w\/.-]+\.[a-z]+)/);
    if (pathMatch) return pathMatch[1]!;
  }

  // Fallback: use the language as a file extension hint
  const extMap: Record<string, string> = {
    tsx: 'component.tsx',
    ts: 'file.ts',
    jsx: 'component.jsx',
    js: 'file.js',
    css: 'styles.css',
    json: 'config.json',
    html: 'index.html',
    sql: 'query.sql',
    py: 'script.py',
    md: 'readme.md',
  };

  if (lang && extMap[lang]) return extMap[lang]!;

  return null;
}
