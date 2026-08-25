import { isIP } from 'node:net';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getDb } from '@/lib/db';
import type { Session } from 'next-auth';
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
  if (process.env.TRUSTED_PROXY === 'true') {
    const realIp = req.headers.get('x-real-ip')?.trim();
    if (realIp && isIP(realIp)) return realIp;

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
  }

  return '127.0.0.1';
}

export const createContext = async (opts: { req: Request }): Promise<Context> => {
  const session = await getServerSession(authOptions);
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
