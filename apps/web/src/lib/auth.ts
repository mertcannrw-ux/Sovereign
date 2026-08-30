import { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import GitHubProvider from 'next-auth/providers/github';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { isIP } from 'node:net';
import { getDb } from './db';
import { checkRateLimit, hashIp } from '@/server/rate-limit';

export function oauthProvidersEnabled(): { google: boolean; github: boolean } {
  return {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  };
}

function buildProviders(): NextAuthOptions['providers'] {
  const enabled = oauthProvidersEnabled();
  const providers: NextAuthOptions['providers'] = [];
  if (enabled.google) {
    providers.push(
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }
  if (enabled.github) {
    providers.push(
      GitHubProvider({
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }
  providers.push(
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
  );
  return providers;
}

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
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/auth/signin',
  },
  providers: buildProviders(),
  callbacks: {
    async signIn({ user, account }) {
      if (!account || account.provider === 'credentials') return true;
      const email = user.email?.trim().toLowerCase();
      if (!email) return false;

      const db = getDb();
      const existing = await db.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });
      if (existing) {
        user.id = existing.id;
        user.email = existing.email;
        if (user.name && user.name !== existing.name) {
          await db.user.update({
            where: { id: existing.id },
            data: {
              name: existing.name ?? user.name,
              avatarUrl: existing.avatarUrl ?? user.image ?? undefined,
            },
          });
        }
        return true;
      }

      const created = await db.user.create({
        data: {
          email,
          name: user.name ?? null,
          avatarUrl: user.image ?? null,
          emailVerified: true,
        },
      });
      user.id = created.id;
      user.email = created.email;
      return true;
    },
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
