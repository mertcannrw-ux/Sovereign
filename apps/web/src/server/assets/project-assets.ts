import { getDb } from '@/lib/db';
import { uploadToR2, deleteFromR2 } from './r2';
import type { ProjectAsset } from '@prisma-generated/prisma/client';

const ALLOWED_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_ASSET_BYTES = 20 * 1024 * 1024; // 20MB

export function detectImageMediaType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return 'image/gif';
  }
  return null;
}

function getExtensionForMediaType(mediaType: string): string {
  switch (mediaType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/png':
    default:
      return 'png';
  }
}

export interface UploadProjectAssetParams {
  projectId: string;
  createdById?: string;
  bytes: Uint8Array;
  mediaType: string;
  prompt?: string;
  source?: 'generated' | 'uploaded';
  width?: number;
  height?: number;
}

/** Upper bound on stored bytes per project; keeps one tenant from filling the bucket. */
const MAX_PROJECT_ASSET_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
const MAX_PROJECT_ASSET_COUNT = 5_000;

interface AssetUsage {
  _count: { _all: number };
  _sum: { byteSize: number | null };
}

function exceedsAssetQuota(usage: AssetUsage, incomingBytes: number): boolean {
  return (
    usage._count._all >= MAX_PROJECT_ASSET_COUNT ||
    (usage._sum.byteSize ?? 0) + incomingBytes > MAX_PROJECT_ASSET_BYTES
  );
}

export async function uploadProjectAsset(params: UploadProjectAssetParams): Promise<ProjectAsset> {
  if (params.bytes.byteLength > MAX_ASSET_BYTES) {
    throw new Error(`Asset size (${params.bytes.byteLength} bytes) exceeds maximum limit of 20MB.`);
  }

  const mediaType = detectImageMediaType(params.bytes);
  if (!mediaType || !ALLOWED_MEDIA_TYPES.has(mediaType)) {
    throw new Error('Unrecognized image format. Allowed types: PNG, JPEG, WebP, GIF.');
  }

  const db = getDb();
  const usage = await db.projectAsset.aggregate({
    where: { projectId: params.projectId },
    _count: { _all: true },
    _sum: { byteSize: true },
  });
  // Reject before uploading: the authoritative check runs again under a lock
  // below, but a project already at its cap should not pay for the transfer.
  if (exceedsAssetQuota(usage, params.bytes.byteLength)) {
    throw new Error('This project has reached its asset storage limit.');
  }

  const ext = getExtensionForMediaType(mediaType);
  const objectKey = `projects/${params.projectId}/assets/${crypto.randomUUID()}.${ext}`;

  const publicUrl = await uploadToR2({
    objectKey,
    bytes: params.bytes,
    contentType: mediaType,
  });

  // 2. Write database record second. The quota is re-checked inside a
  // per-project advisory lock: concurrent uploads would otherwise all read the
  // pre-insert total and commit past the cap together.
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`project-assets:${params.projectId}`}, 0))`;
      const lockedUsage = await tx.projectAsset.aggregate({
        where: { projectId: params.projectId },
        _count: { _all: true },
        _sum: { byteSize: true },
      });
      if (exceedsAssetQuota(lockedUsage, params.bytes.byteLength)) {
        throw new Error('This project has reached its asset storage limit.');
      }
      return tx.projectAsset.create({
        data: {
          projectId: params.projectId,
          createdById: params.createdById,
          objectKey,
          publicUrl,
          mediaType,
          byteSize: params.bytes.byteLength,
          width: params.width,
          height: params.height,
          source: params.source ?? 'generated',
          prompt: params.prompt,
        },
      });
    });
  } catch (dbError) {
    // No row was written (or the transaction rolled back), so the object just
    // uploaded would otherwise be orphaned in the bucket.
    try {
      await deleteFromR2(objectKey);
    } catch {
      // Ignore R2 cleanup error on DB failure rollback
    }
    throw dbError;
  }
}

export async function deleteProjectAsset(assetId: string, projectId: string): Promise<void> {
  const db = getDb();
  const asset = await db.projectAsset.findFirst({
    where: { id: assetId, projectId },
  });

  if (!asset) {
    throw new Error('Project asset not found.');
  }

  await db.projectAsset.delete({
    where: { id: asset.id },
  });

  await deleteFromR2(asset.objectKey).catch((err) => {
    console.error(`[project-assets] orphaned R2 object after DB delete: ${asset.objectKey}`, err);
  });
}

export async function listProjectAssets(projectId: string): Promise<ProjectAsset[]> {
  const db = getDb();
  return db.projectAsset.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Object keys for the assets of one or more projects. Read *before* the rows
 * are deleted: the rows cascade with the project, and once they are gone the
 * keys are unrecoverable.
 */
export async function listProjectAssetObjectKeys(projectIds: string[]): Promise<string[]> {
  if (projectIds.length === 0) return [];
  const db = getDb();
  const assets = await db.projectAsset.findMany({
    where: { projectId: { in: projectIds } },
    select: { objectKey: true },
  });
  return assets.map((asset) => asset.objectKey);
}

const ASSET_DELETE_BATCH_SIZE = 25;

/**
 * Delete stored objects by key. Call only after the owning rows have committed:
 * object deletion is best-effort per key - a transient R2 failure must not
 * block the project delete - but every failure is logged so the orphan can be
 * reclaimed manually.
 *
 * Deletes run in bounded batches: a large account can own tens of thousands of
 * assets, and firing them all through one `Promise.all` exhausts sockets,
 * hits S3 rate limits, and abandons the rest of the batch as soon as one call
 * throws.
 */
export async function deleteAssetObjects(objectKeys: readonly string[]): Promise<void> {
  for (let start = 0; start < objectKeys.length; start += ASSET_DELETE_BATCH_SIZE) {
    await Promise.all(
      objectKeys.slice(start, start + ASSET_DELETE_BATCH_SIZE).map((objectKey) =>
        deleteFromR2(objectKey).catch((error) => {
          console.error(`[project-assets] failed to delete object ${objectKey}`, error);
        }),
      ),
    );
  }
}
