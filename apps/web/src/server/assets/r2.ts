import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { env } from '@/env';

import fs from 'node:fs';
import path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Local-disk fallback storage. Deliberately kept OUT of `public/` so Next.js never
// serves assets statically — files are served only through the authenticated
// `/api/assets` route, which verifies both the DB record and project ownership.
export const LOCAL_ASSET_ROOT = path.join(process.cwd(), '.private-assets');

export interface R2ConfigStatus {
  isConfigured: boolean;
  storageMode: 'r2' | 'local';
  reason?: string;
}

export function getR2ConfigStatus(): R2ConfigStatus {
  const hasAccountId = Boolean(env.R2_ACCOUNT_ID && env.R2_ACCOUNT_ID.trim().length > 0);
  const hasAccessKey = Boolean(env.R2_ACCESS_KEY_ID && env.R2_ACCESS_KEY_ID.trim().length > 0);
  const hasSecretKey = Boolean(env.R2_SECRET_ACCESS_KEY && env.R2_SECRET_ACCESS_KEY.trim().length > 0);
  const hasBucket = Boolean(env.R2_BUCKET_NAME && env.R2_BUCKET_NAME.trim().length > 0);
  const hasPublicUrl = Boolean(env.R2_PUBLIC_URL && env.R2_PUBLIC_URL.trim().length > 0);

  const count = [hasAccountId, hasAccessKey, hasSecretKey, hasBucket, hasPublicUrl].filter(Boolean).length;

  if (count === 5) {
    return { isConfigured: true, storageMode: 'r2' };
  }

  return {
    isConfigured: true,
    storageMode: 'local',
    reason: 'Cloudflare R2 not configured (missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, or R2_PUBLIC_URL). Falling back to local disk storage at .private-assets/.',
  };
}


let r2ClientInstance: S3Client | null = null;

export function getR2Client(): S3Client {
  const status = getR2ConfigStatus();
  if (!status.isConfigured) {
    throw new Error(status.reason ?? 'R2 storage is not properly configured.');
  }

  if (!r2ClientInstance) {
    const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
    r2ClientInstance = new S3Client({
      region: 'auto',
      endpoint,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID!,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }

  return r2ClientInstance;
}

export function signAssetUrl(objectKey: string, expiresInSeconds = 60 * 60 * 24 * 7): string {
  const secret = env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET must be set to sign asset URLs');
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = `${objectKey}:${expires}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `expires=${expires}&sig=${sig}`;
}

export function verifyAssetToken(objectKey: string, expires: string, sig: string): boolean {
  const secret = env.NEXTAUTH_SECRET;
  if (!secret) return false;
  const expNum = Number(expires);
  if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
  const payload = `${objectKey}:${expNum}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function uploadToR2(opts: {
  objectKey: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<string> {
  const status = getR2ConfigStatus();
  const hostUrl = (env.NEXTAUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  if (status.storageMode === 'local') {
    const relativePath = opts.objectKey.startsWith('/') ? opts.objectKey.slice(1) : opts.objectKey;
    const fullPath = path.join(LOCAL_ASSET_ROOT, relativePath);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, opts.bytes);
    return `${hostUrl}/api/assets/${relativePath}?${signAssetUrl(relativePath)}`;
  }

  const client = getR2Client();
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME!,
    Key: opts.objectKey,
    Body: opts.bytes,
    ContentType: opts.contentType,
  });

  await client.send(command);

  const baseUrl = env.R2_PUBLIC_URL!.replace(/\/+$/, '');
  return `${baseUrl}/${opts.objectKey}`;
}

export async function deleteFromR2(objectKey: string): Promise<void> {
  const status = getR2ConfigStatus();
  if (status.storageMode === 'local') {
    const relativePath = objectKey.startsWith('/') ? objectKey.slice(1) : objectKey;
    const fullPath = path.join(LOCAL_ASSET_ROOT, relativePath);
    await fs.promises.unlink(fullPath).catch((err) => {
      // ENOENT just means the object was already gone — fine. Any other error
      // (permissions, I/O) must propagate so the caller does not delete the DB
      // row for a file that still exists on disk.
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
    });
    return;
  }

  const client = getR2Client();
  const command = new DeleteObjectCommand({
    Bucket: env.R2_BUCKET_NAME!,
    Key: objectKey,
  });

  await client.send(command);
}
