import { NextAuthOptions } from 'next-auth';
import { PrismaAdapter } from '@auth/prisma-adapter';
import GoogleProvider from 'next-auth/providers/google';
import GitHubProvider from 'next-auth/providers/github';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { isIP } from 'node:net';
import { getDb } from './db';
import { checkRateLimit, hashIp } from '@/server/rate-limit';

/**
 * Resolve the caller's real IP for sign-in rate limiting. Only meaningful when
 * `TRUSTED_PROXY` is set; otherwise returns null so callers keep their existing
 * keying (per-email) instead of collapsing onto a single global bucket.
 */
function trustedProxyClientIp(req: unknown): string | null {
  if (process.env.TRUSTED_PROXY !== 'true') return null;
  const headers = (req as { headers?: Headers })?.headers;
  if (!headers || typeof headers.get !== 'function') return null;

  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp && isIP(realIp)) return realIp;

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const entries = forwarded
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    // Right-most entry is appended by our trusted proxy.
    const last = entries[entries.length - 1];
    if (last && isIP(last)) return last;
  }
  return null;
}
export const authOptions: NextAuthOptions = {
  get adapter() { return PrismaAdapter(getDb() as unknown as Parameters<typeof PrismaAdapter>[0]) as NextAuthOptions['adapter']; },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/auth/signin',
  },
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    }),
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    }),
    CredentialsProvider({
      id: 'credentials',
      name: 'Email & Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email.trim().toLowerCase();
        // Key by the real client IP when a trusted proxy is configured, so an
        // attacker cannot burn the limit of a known victim's email. Falls back
        // to per-email keying otherwise (keeps dev/local buckets distinct).
        const ip = trustedProxyClientIp(req);
        const rate = await checkRateLimit('signIn', ip ? hashIp(ip) : email);
        if (!rate.allowed) {
          throw new Error('Too many sign-in attempts. Please try again later.');
        }

        const user = await getDb().user.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
        });

        if (!user) return null;
        // Password hash is stored directly on the User record
        if (!user.passwordHash) return null;

        const isValid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!isValid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.avatarUrl,
        };
      },
    }),
  ],
  callbacks: {
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },
  },
};
