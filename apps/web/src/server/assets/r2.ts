import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { env } from '@/env';

import fs from 'node:fs';
import path from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Local-disk fallback storage. Deliberately kept OUT of `public/` so Next.js never
// serves assets statically - files are served only through the authenticated
// `/api/assets` route, which verifies both the DB record and project ownership.
export const LOCAL_ASSET_ROOT = path.join(process.cwd(), '.private-assets');

/**
 * Resolve an object key to a path under LOCAL_ASSET_ROOT, refusing any key
 * (e.g. one containing `..`) that would escape it.
 */
function resolveLocalAssetPath(objectKey: string): string {
  const resolved = path.normalize(path.join(LOCAL_ASSET_ROOT, objectKey));
  if (!resolved.startsWith(LOCAL_ASSET_ROOT + path.sep)) {
    throw new Error(`Asset key escapes the local asset root: ${objectKey}`);
  }
  return resolved;
}

export interface R2ConfigStatus {
  /**
   * True only when durable object storage (R2/S3) is fully configured.
   *
   * The local-disk fallback deliberately reports `false` here: this app runs on
   * ephemeral filesystems, so assets written to `.private-assets/` disappear on
   * the next deploy while their database rows survive. Callers that require
   * durability (image generation) must gate on this flag; callers that only
   * need to know where bytes land should read `storageMode`.
   */
  isConfigured: boolean;
  /** Where uploads will actually be written. */
  storageMode: 'r2' | 'local';
  reason?: string;
}

export function getR2ConfigStatus(): R2ConfigStatus {
  const hasAccountId = Boolean(env.R2_ACCOUNT_ID && env.R2_ACCOUNT_ID.trim().length > 0);
  const hasAccessKey = Boolean(env.R2_ACCESS_KEY_ID && env.R2_ACCESS_KEY_ID.trim().length > 0);
  const hasSecretKey = Boolean(
    env.R2_SECRET_ACCESS_KEY && env.R2_SECRET_ACCESS_KEY.trim().length > 0,
  );
  const hasBucket = Boolean(env.R2_BUCKET_NAME && env.R2_BUCKET_NAME.trim().length > 0);

  // R2_PUBLIC_URL is deliberately not required: assets are served through
  // `/api/assets` with a signed token minted from NEXTAUTH_URL, so a public
  // bucket URL is neither used nor wanted (it would be an unauthenticated,
  // non-revocable handle). Requiring it silently downgraded valid
  // configurations to ephemeral local storage.
  if (hasAccountId && hasAccessKey && hasSecretKey && hasBucket) {
    return { isConfigured: true, storageMode: 'r2' };
  }

  return {
    isConfigured: false,
    storageMode: 'local',
    reason:
      'Cloudflare R2 not configured (missing R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY or R2_BUCKET_NAME). Falling back to local disk storage at .private-assets/, which is not durable across deploys.',
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

/**
 * Signed asset URL query string.
 *
 * `expiresInSeconds` mints a short-lived token (the settings UI re-signs on
 * every read). Passing `null` mints a *non-expiring* token instead: generated
 * applications persist the URL in their source, and a URL that dies after a
 * week silently breaks every deployed app. The non-expiring form is still
 * bound to the object key and only resolves while the `ProjectAsset` row
 * exists, so deleting the asset (or the project) revokes it.
 */
export function signAssetUrl(
  objectKey: string,
  expiresInSeconds: number | null = 60 * 60 * 24 * 7,
): string {
  const secret = env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET must be set to sign asset URLs');
  if (expiresInSeconds === null) {
    return `expires=none&sig=${assetSignature(objectKey, 'none')}`;
  }
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return `expires=${expires}&sig=${assetSignature(objectKey, String(expires))}`;
}

function assetSignature(objectKey: string, expires: string): string {
  const secret = env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET must be set to sign asset URLs');
  // Domain-separated so a permanent token can never be replayed as an expiring
  // one (or vice versa).
  const payload = `asset:${expires}:${objectKey}`;
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Signature minted by releases before the domain-separated payload. Those URLs
 * are already persisted in generated app source and in deployed bundles, so
 * verification must keep accepting them: the new payload alone turned every
 * image signed before a deploy into a 401.
 */
function legacyAssetSignature(objectKey: string, expires: string): string {
  const secret = env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET must be set to sign asset URLs');
  return createHmac('sha256', secret).update(`${objectKey}:${expires}`).digest('hex');
}

function signaturesMatch(sig: string, expected: string): boolean {
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function verifyAssetToken(objectKey: string, expires: string, sig: string): boolean {
  const secret = env.NEXTAUTH_SECRET;
  if (!secret) return false;

  let expected: string;
  let legacyExpected: string | null = null;
  if (expires === 'none') {
    // The old scheme never minted permanent tokens, so there is no legacy
    // signature to accept for this form.
    expected = assetSignature(objectKey, 'none');
  } else {
    const expNum = Number(expires);
    if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false;
    expected = assetSignature(objectKey, String(expNum));
    legacyExpected = legacyAssetSignature(objectKey, String(expNum));
  }

  if (signaturesMatch(sig, expected)) return true;
  return legacyExpected !== null && signaturesMatch(sig, legacyExpected);
}

export async function uploadToR2(opts: {
  objectKey: string;
  bytes: Uint8Array;
  contentType: string;
}): Promise<string> {
  const status = getR2ConfigStatus();
  const hostUrl = (env.NEXTAUTH_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const key = opts.objectKey.startsWith('/') ? opts.objectKey.slice(1) : opts.objectKey;

  if (status.storageMode === 'local') {
    const fullPath = resolveLocalAssetPath(key);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, opts.bytes);
  } else {
    const client = getR2Client();
    await client.send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET_NAME!,
        Key: opts.objectKey,
        Body: opts.bytes,
        ContentType: opts.contentType,
      }),
    );
  }

  // Identical same-origin URL for both backends. The token is bound to the
  // object key and validated against the `ProjectAsset` row on every read, so
  // it stops working when the row is deleted. It is deliberately non-expiring:
  // generated applications persist this string in their source, and a URL that
  // lapses would break every image in every deployed app.
  return `${hostUrl}/api/assets/${key}?${signAssetUrl(key, null)}`;
}

/**
 * Fetch an object's bytes for the authenticated asset route. Returns null when
 * the key does not exist, so callers can answer 404.
 */
export async function downloadAssetBytes(
  objectKey: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    const response = await getR2Client().send(
      new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME!, Key: objectKey }),
    );
    const body = response.Body;
    if (!body) return null;
    const bytes = await body.transformToByteArray();
    // `transformToByteArray` is typed with the widest ArrayBufferLike; re-wrap
    // so callers can hand the value to a Response body without a cast.
    return new Uint8Array(bytes);
  } catch (error) {
    if (error instanceof Error && error.name === 'NoSuchKey') return null;
    throw error;
  }
}

export async function deleteFromR2(objectKey: string): Promise<void> {
  const status = getR2ConfigStatus();
  if (status.storageMode === 'local') {
    const relativePath = objectKey.startsWith('/') ? objectKey.slice(1) : objectKey;
    const fullPath = resolveLocalAssetPath(relativePath);
    await fs.promises.unlink(fullPath).catch((err) => {
      // ENOENT just means the object was already gone - fine. Any other error
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
