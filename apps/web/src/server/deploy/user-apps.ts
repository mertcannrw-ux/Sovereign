/**
 * Publishing built user apps to the `user-apps` R2 bucket.
 *
 * The Worker in `infra/user-apps-host` serves `<subdomain>.<DEPLOY_DOMAIN>` from
 * the `live/<subdomain>/` prefix. This module is the only writer, so the limits
 * below are what keep R2 inside its free tier no matter what users do:
 *
 *   Storage  ≤ MAX_LIVE_APPS × MAX_BUNDLE_BYTES          = 1000 × 5 MB  =  5 GB  (free: 10 GB)
 *   Writes   ≤ MAX_DEPLOYS_PER_DAY × (MAX_FILES + 2) × 31 ≈ 632k / month       (free: 1M)
 *   Reads    — bounded by the Worker (one read per request, free-plan request cap)
 *
 * Each deploy overwrites the app in place and deletes files the new build no
 * longer has, so an app never occupies more than one bundle. Older versions
 * live on as project snapshots in the database, not in R2.
 */

import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { env } from '@/env';

export const MAX_FILES = 100;
export const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
export const MAX_DEPLOYS_PER_DAY = 200;
export const MAX_LIVE_APPS = 1000;
export const MAX_LIVE_APPS_PER_USER = 3;

/** Must match RESERVED in infra/user-apps-host/src/index.js — the Worker refuses these. */
const RESERVED_SUBDOMAINS = new Set([
  'www',
  'api',
  'app',
  'mail',
  'admin',
  'proxy',
  'relay',
  'test',
  'status',
]);
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SAFE_PATH = /^[A-Za-z0-9._@-]+(?:\/[A-Za-z0-9._@-]+)*$/;

const CONTENT_TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  map: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
  wasm: 'application/wasm',
};

export interface BundleFile {
  path: string;
  bytes: Uint8Array;
}

export class DeployRejectedError extends Error {
  override name = 'DeployRejectedError';
}

export function isDeployConfigured(): boolean {
  return Boolean(
    env.DEPLOY_DOMAIN &&
    env.DEPLOY_R2_BUCKET &&
    env.R2_ACCOUNT_ID &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY,
  );
}

/**
 * The project's slug when it is a usable, unreserved DNS label; otherwise a
 * stable id-derived name (slugs run up to ~90 characters, past the 63 limit).
 */
export function deploySubdomain(project: { id: string; slug: string }): string {
  const { slug } = project;
  const usable =
    DNS_LABEL.test(slug) && slug.slice(2, 4) !== '--' && !RESERVED_SUBDOMAINS.has(slug);
  return usable ? slug : `app-${project.id.replace(/-/g, '').slice(0, 12)}`;
}

export function deployUrl(subdomain: string): string {
  return `https://${subdomain}.${env.DEPLOY_DOMAIN}`;
}

export function contentTypeFor(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

/** Decode and check an uploaded bundle. Never trust the client's build. */
export function validateBundle(files: { path: string; data: string }[]): BundleFile[] {
  if (files.length === 0) throw new DeployRejectedError('The build produced no files.');
  if (files.length > MAX_FILES) {
    throw new DeployRejectedError(
      `The build has ${files.length} files; the limit is ${MAX_FILES}.`,
    );
  }
  const seen = new Set<string>();
  let total = 0;
  const decoded = files.map(({ path, data }) => {
    const segments = path.split('/');
    if (!SAFE_PATH.test(path) || segments.some((s) => s === '.' || s === '..')) {
      throw new DeployRejectedError(`Invalid file path: ${path.slice(0, 120)}`);
    }
    if (seen.has(path)) throw new DeployRejectedError(`Duplicate file path: ${path}`);
    seen.add(path);
    const bytes = new Uint8Array(Buffer.from(data, 'base64'));
    total += bytes.byteLength;
    if (total > MAX_BUNDLE_BYTES) {
      throw new DeployRejectedError(
        `The build is larger than ${MAX_BUNDLE_BYTES / 1024 / 1024} MB.`,
      );
    }
    return { path, bytes };
  });
  if (!seen.has('index.html')) throw new DeployRejectedError('The build has no index.html.');
  return decoded;
}

let client: S3Client | null = null;

function r2(): S3Client {
  client ??= new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
    // Only send checksums S3 requires; R2 rejects some optional ones.
    requestChecksumCalculation: 'WHEN_REQUIRED',
  });
  return client;
}

async function listKeys(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await r2().send(
      new ListObjectsV2Command({
        Bucket: env.DEPLOY_R2_BUCKET!,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function deleteKeys(keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    await r2().send(
      new DeleteObjectsCommand({
        Bucket: env.DEPLOY_R2_BUCKET!,
        Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }
}

/**
 * Replace the app's live files. HTML goes last: Vite's asset names are
 * content-hashed, so until the new index.html lands visitors keep getting the
 * old page with the old (still present) assets.
 */
export async function publishBundle(subdomain: string, files: BundleFile[]): Promise<void> {
  const prefix = `live/${subdomain}/`;
  const ordered = [
    ...files.filter((f) => !f.path.endsWith('.html')),
    ...files.filter((f) => f.path.endsWith('.html')),
  ];
  const put = (file: BundleFile) =>
    r2().send(
      new PutObjectCommand({
        Bucket: env.DEPLOY_R2_BUCKET!,
        Key: prefix + file.path,
        Body: file.bytes,
        ContentType: contentTypeFor(file.path),
      }),
    );
  const assets = ordered.filter((f) => !f.path.endsWith('.html'));
  for (let i = 0; i < assets.length; i += 8) await Promise.all(assets.slice(i, i + 8).map(put));
  for (const html of ordered.filter((f) => f.path.endsWith('.html'))) await put(html);

  const keep = new Set(files.map((f) => prefix + f.path));
  await deleteKeys((await listKeys(prefix)).filter((key) => !keep.has(key)));
}

/** Take an app offline. The Worker never caches HTML, so it answers 404 right away. */
export async function unpublishBundle(subdomain: string): Promise<void> {
  await deleteKeys(await listKeys(`live/${subdomain}/`));
}
