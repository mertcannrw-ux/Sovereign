import { isIP } from 'node:net';
import { getVerifiedSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import type { Session } from 'next-auth';
import { env } from '@/env';
import { hashIp } from '@/server/rate-limit';

export interface Context {
  session: Session | null;
  user: Session['user'] | null;
  db: ReturnType<typeof getDb>;
  req: Request;
  requestId: string;
  ipHash: string;
  userAgent: string;
}

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}

function getClientIp(req: Request): string {
  if (env.TRUSTED_PROXY) {
    const forwarded = req.headers.get('x-forwarded-for');
    if (forwarded) {
      const entries = forwarded
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      // Proxies APPEND the caller's address, so the right-most entry is the one
      // added by our trusted proxy. Earlier entries are client-supplied and
      // spoofable — never trust them for a rate-limit key.
      const last = entries[entries.length - 1];
      if (last && isIP(last)) return last;
    }

    // X-Forwarded-For wins: a proxy/CDN that appends to XFF but does not set
    // X-Real-IP (a common default) would otherwise let any client mint a fresh
    // rate-limit bucket by sending an arbitrary `X-Real-IP` header. Only fall
    // back to it when XFF is absent, and validate it just the same.
    const realIp = req.headers.get('x-real-ip')?.trim();
    if (realIp && isIP(realIp)) return realIp;
  }

  return '127.0.0.1';
}

export const createContext = async (opts: { req: Request }): Promise<Context> => {
  // Verified (not raw) session: tokens minted before a password reset or a
  // "sign out everywhere" are rejected here, so every tRPC procedure inherits
  // revocation for free.
  const session = await getVerifiedSession();
  const ip = getClientIp(opts.req);

  return {
    session,
    user: session?.user ?? null,
    db: getDb(),
    req: opts.req,
    requestId: generateRequestId(),
    ipHash: hashIp(ip),
    userAgent: opts.req.headers.get('user-agent') ?? '',
  };
};
