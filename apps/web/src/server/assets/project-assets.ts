import { getDb } from '@/lib/db';
import { uploadToR2, deleteFromR2 } from './r2';
import type { ProjectAsset } from '@prisma-generated/prisma/client';

const ALLOWED_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_ASSET_BYTES = 20 * 1024 * 1024; // 20MB

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

export async function uploadProjectAsset(params: UploadProjectAssetParams): Promise<ProjectAsset> {

  if (!ALLOWED_MEDIA_TYPES.has(params.mediaType)) {
    throw new Error(`Unsupported media type: ${params.mediaType}. Allowed types: PNG, JPEG, WebP, GIF.`);
  }

  if (params.bytes.byteLength > MAX_ASSET_BYTES) {
    throw new Error(`Asset size (${params.bytes.byteLength} bytes) exceeds maximum limit of 20MB.`);
  }

  const ext = getExtensionForMediaType(params.mediaType);
  const objectKey = `projects/${params.projectId}/assets/${crypto.randomUUID()}.${ext}`;

  // 1. Write R2 object first
  const publicUrl = await uploadToR2({
    objectKey,
    bytes: params.bytes,
    contentType: params.mediaType,
  });

  // 2. Write database record second
  const db = getDb();
  try {
    const asset = await db.projectAsset.create({
      data: {
        projectId: params.projectId,
        createdById: params.createdById,
        objectKey,
        publicUrl,
        mediaType: params.mediaType,
        byteSize: params.bytes.byteLength,
        width: params.width,
        height: params.height,
        source: params.source ?? 'generated',
        prompt: params.prompt,
      },
    });
    return asset;
  } catch (dbError) {
    // DB write failed: perform compensation cleanup on R2
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
