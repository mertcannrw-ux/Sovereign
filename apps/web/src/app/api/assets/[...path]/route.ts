import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { getVerifiedSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { requireProjectRole } from '@/server/authz';
import {
  LOCAL_ASSET_ROOT,
  downloadAssetBytes,
  getR2ConfigStatus,
  verifyAssetToken,
} from '@/server/assets/r2';
import type { Context } from '@/lib/trpc/context';

/** Media-type allowlist mirrored from uploadProjectAsset's magic-byte check. */
function assetContentType(objectKey: string): string {
  if (objectKey.endsWith('.png')) return 'image/png';
  if (objectKey.endsWith('.jpg') || objectKey.endsWith('.jpeg')) return 'image/jpeg';
  if (objectKey.endsWith('.webp')) return 'image/webp';
  if (objectKey.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

// Storage backend details live in `server/assets/r2.ts`; this route serves ONLY
// files that have a matching ProjectAsset record. Local-disk assets are read
// from `.private-assets/projects/<projectId>/assets/...` (never `public/`, so
// Next.js cannot serve them statically); R2-backed assets are fetched through
// this same route behind the same checks. Legacy ProjectAsset rows that stored
// a bucket public URL still point directly at R2 and never reach this route.

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await context.params;
  if (segments.length === 0) return new NextResponse('Asset not found', { status: 404 });

  // Asset records store the full object key (`projects/<projectId>/assets/<uuid>.<ext>`).
  // Reconstruct it from the route segments.
  const objectKey = segments.join('/');
  const relativePath = objectKey.startsWith('/') ? objectKey.slice(1) : objectKey;

  // Prevent any path-traversal style tricks from escaping the asset root.
  const resolved = path.normalize(path.join(LOCAL_ASSET_ROOT, relativePath));
  if (!resolved.startsWith(LOCAL_ASSET_ROOT + path.sep)) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Signed URL bypass for cross-origin WebContainer preview:
  // `publicUrl` is minted as `/api/assets/<key>?expires=&sig=` (HMAC of
  // `objectKey:expires` with NEXTAUTH_SECRET) for BOTH storage backends. If
  // present and valid, it authorizes the request without a cookie; without it
  // the caller needs a session plus VIEWER access to the owning project.
  const url = new URL(request.url);
  const tokenExpires = url.searchParams.get('expires');
  const tokenSig = url.searchParams.get('sig');
  const hasValidPreviewToken =
    tokenExpires !== null &&
    tokenSig !== null &&
    verifyAssetToken(relativePath, tokenExpires, tokenSig);

  if (!hasValidPreviewToken) {
    // Auth: the caller must be signed in.
    const session = await getVerifiedSession();
    if (!session?.user?.id) return new NextResponse('Unauthorized', { status: 401 });

    // The asset must exist in the DB (and be for the right project) before we touch disk.
    const dbCheck = getDb();
    const assetCheck = await dbCheck.projectAsset.findUnique({
      where: { objectKey: relativePath },
    });
    if (!assetCheck) return new NextResponse('Asset not found', { status: 404 });

    // Authorization: the caller must be able to view the owning project.
    try {
      const ctx = {
        user: { id: session.user.id } as { id: string },
        db: dbCheck,
      } as Pick<Context, 'user' | 'db'>;
      await requireProjectRole(ctx as Context, assetCheck.projectId, 'VIEWER');
    } catch {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  const db = getDb();
  const asset = await db.projectAsset.findUnique({ where: { objectKey: relativePath } });
  if (!asset) return new NextResponse('Asset not found', { status: 404 });

  // Only serve the exact object key recorded in the DB. Content type comes from a
  // strict allowlist of the media types uploads are restricted to (magic bytes
  // are verified in uploadProjectAsset); anything else is served as octet-stream
  // and never as HTML/SVG to avoid any stored-XSS surface.
  const contentType = assetContentType(relativePath);
  try {
    const fileBuffer =
      getR2ConfigStatus().storageMode === 'r2'
        ? await downloadAssetBytes(relativePath)
        : await fs.promises.readFile(resolved);
    if (!fileBuffer) return new NextResponse('Asset not found', { status: 404 });

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    });
  } catch {
    return new NextResponse('Asset not found', { status: 404 });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    },
  });
}
