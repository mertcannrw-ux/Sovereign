import { getVerifiedSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import type { Session } from 'next-auth';
import { hashIp, trustedClientIp } from '@/server/rate-limit';

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

export const createContext = async (opts: { req: Request }): Promise<Context> => {
  // Verified (not raw) session: tokens minted before a password reset or a
  // "sign out everywhere" are rejected here, so every tRPC procedure inherits
  // revocation for free.
  const session = await getVerifiedSession();
  // Without a trusted proxy the real client address is unknowable, so every
  // request collapses to a constant rather than pretending to a per-IP bucket
  // that does not exist.
  const ip = trustedClientIp(opts.req.headers) ?? '127.0.0.1';

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
