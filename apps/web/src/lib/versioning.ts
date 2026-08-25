import { Prisma } from '@prisma-generated/prisma/client';
import { getDb } from '@/lib/db';
import { createHash } from 'node:crypto';
import type { DbClient } from '@/lib/project-files';

// ─── Types ─────────────────────────────────────────────

export interface VersionDiffEntry {
  file: string;
  operation: 'create' | 'update' | 'delete' | 'restore';
  before?: string;
  after?: string;
}

export interface VersionInfo {
  id: string;
  versionNumber: number;
  manifest: unknown;
  createdAt: Date;
  sourceMessageId: string | null;
  /** Set only for restore-point snapshots (e.g. "Restored version 3"). */
  message: string | null;
}
export interface RestoredProjectFile {
  path: string;
  content: string;
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
    },
  });

  return { id: version.id, versionNumber: version.versionNumber };
}

/**
 * Get the full version timeline for a project, ordered chronologically.
 */
export async function getVersions(projectId: string): Promise<VersionInfo[]> {
  const versions = await getDb().projectSnapshot.findMany({
    where: { projectId },
    orderBy: { versionNumber: 'asc' },
  });

  return versions.map((v) => ({
    id: v.id,
    versionNumber: v.versionNumber,
    manifest: v.manifest,
    createdAt: v.createdAt,
    sourceMessageId: v.sourceMessageId,
    message: v.message,
  }));
}

/**
 * Restore a project to a specific version by recording a restore event.
 * Creates a new version entry that documents the rollback.
 */
export async function restoreVersion(
  projectId: string,
  versionNumber: number,
): Promise<{ id: string; versionNumber: number; files: RestoredProjectFile[] }> {
  const snapshots = await getDb().projectSnapshot.findMany({
    where: { projectId, versionNumber: { lte: versionNumber } },
    orderBy: { versionNumber: 'asc' },
    select: { versionNumber: true, manifest: true },
  });
  if (!snapshots.some((snapshot) => snapshot.versionNumber === versionNumber)) {
    throw new Error(`Version ${versionNumber} not found for this project`);
  }

  const files = reconstructProjectFiles(snapshots.map((snapshot) => snapshot.manifest));
  const currentFiles = await getDb().projectFile.findMany({
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
  const version = await getDb().$transaction(async (tx) => {
    // Serialize concurrent restores to the same project — same pattern as
    // createVersion. Without this, two simultaneous restores race the
    // versionNumber allocation (both read N, both write N+1).
    const lockKey = projectIdToAdvisoryKey(projectId);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
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
    return tx.projectSnapshot.create({
      data: {
        projectId,
        versionNumber: newVersionNumber,
        manifest: manifest as Prisma.InputJsonValue,
        sourceMessageId: null,
        createdById: null,
        message: `Restored version ${versionNumber}`,
      },
    });
  });

  return { id: version.id, versionNumber: version.versionNumber, files };
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
