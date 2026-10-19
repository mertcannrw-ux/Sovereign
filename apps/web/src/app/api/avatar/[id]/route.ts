import { NextResponse } from 'next/server';
import { getVerifiedSession } from '@/lib/auth';
import { getDb } from '@/lib/db';

/**
 * Serve an uploaded avatar (account.setAvatar). Signed-in users only: avatars
 * show next to names in the app, never on public pages. The URL carries a
 * version, so the image can be cached for good.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getVerifiedSession();
  if (!session) return new NextResponse('Unauthorized', { status: 401 });

  const { id } = await context.params;
  const user = await getDb().user.findUnique({
    where: { id },
    select: { avatarImage: true, avatarMime: true },
  });
  if (!user?.avatarImage || !user.avatarMime) {
    return new NextResponse('Not found', { status: 404 });
  }

  return new NextResponse(new Uint8Array(user.avatarImage), {
    headers: {
      'Content-Type': user.avatarMime,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const dynamic = 'force-dynamic';
