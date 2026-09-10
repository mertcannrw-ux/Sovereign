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

export async function uploadProjectAsset(params: UploadProjectAssetParams): Promise<ProjectAsset> {
  if (params.bytes.byteLength > MAX_ASSET_BYTES) {
    throw new Error(`Asset size (${params.bytes.byteLength} bytes) exceeds maximum limit of 20MB.`);
  }

  const mediaType = detectImageMediaType(params.bytes);
  if (!mediaType || !ALLOWED_MEDIA_TYPES.has(mediaType)) {
    throw new Error('Unrecognized image format. Allowed types: PNG, JPEG, WebP, GIF.');
  }

  const ext = getExtensionForMediaType(mediaType);
  const objectKey = `projects/${params.projectId}/assets/${crypto.randomUUID()}.${ext}`;

  const publicUrl = await uploadToR2({
    objectKey,
    bytes: params.bytes,
    contentType: mediaType,
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
        mediaType,
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
