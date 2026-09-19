import { NextAuthOptions, getServerSession, type Session } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import GitHubProvider from 'next-auth/providers/github';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { isIP } from 'node:net';
import { getDb } from './db';
import { canAdoptAccountByEmail } from './account-linking';
import { checkRateLimit, hashIp } from '@/server/rate-limit';
import { ensurePersonalOrganization } from '@/server/onboarding';

export function oauthProvidersEnabled(): { google: boolean; github: boolean } {
  return {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  };
}

function buildProviders(): NextAuthOptions['providers'] {
  const enabled = oauthProvidersEnabled();
  const providers: NextAuthOptions['providers'] = [];
  // `allowDangerousEmailAccountLinking` is deliberately NOT set. This app has no
  // email-verification flow, so an attacker can register the victim's address
  // with a password they control; auto-linking an OAuth identity onto that row
  // would hand the attacker continued password access to the victim's account
  // (account pre-hijacking). Linking decisions live in the `signIn` callback,
  // which only adopts an existing row when it cannot already be controlled by
  // someone else (see canAdoptAccountByEmail).
  if (enabled.google) {
    providers.push(
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      }),
    );
  }
  if (enabled.github) {
    providers.push(
      GitHubProvider({
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
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
        // Key by IP+email when a trusted proxy is configured, so an attacker
        // cannot burn the limit of a known victim's email from their own IP
        // (and a victim's own sign-ins never share the attacker's bucket).
        // Falls back to per-email keying otherwise (keeps dev/local buckets
        // distinct and never collapses onto a single global key).
        const ip = trustedProxyClientIp(req);
        const rate = await checkRateLimit('signIn', ip ? `${hashIp(ip)}:${email}` : email);
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
          sessionVersion: user.sessionVersion,
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
 *
 * Kept behaviourally identical to `getClientIp` in `lib/trpc/context.ts`.
 */
function trustedProxyClientIp(req: unknown): string | null {
  if (process.env.TRUSTED_PROXY !== 'true') return null;
  const headers = (req as { headers?: Headers })?.headers;
  if (!headers || typeof headers.get !== 'function') return null;

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const entries = forwarded
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    // Right-most entry is appended by our trusted proxy. Earlier entries are
    // client-supplied and spoofable, so they are never used for the key.
    const last = entries[entries.length - 1];
    if (last && isIP(last)) return last;
  }

  // X-Forwarded-For wins: if the proxy appends to XFF without setting
  // X-Real-IP, honouring a client-supplied `X-Real-IP` first would hand out a
  // fresh rate-limit bucket per request. Only used when XFF is absent.
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp && isIP(realIp)) return realIp;

  return null;
}

/**
 * Best-effort onboarding at sign-in: `projects.create` requires an
 * organizationId, so an account without any organization dead-ends at
 * "No workspace found". `ensurePersonalOrganization` is idempotent and creates
 * the personal workspace only when the user has none.
 *
 * Deliberately swallows failures: a provisioning problem (missing table,
 * transient database error) must never block an otherwise valid sign-in, and
 * the next sign-in retries.
 */
async function ensureWorkspaceForSignIn(userId: string, name?: string | null): Promise<void> {
  try {
    await ensurePersonalOrganization(getDb(), userId, name);
  } catch (error) {
    console.error('[auth] failed to ensure personal organization for user', userId, error);
  }
}

/**
 * NextAuth configuration. The account-linking policy used by the `signIn`
 * callback lives in `lib/account-linking.ts` so it can be unit-tested without
 * booting the server environment.
 */
export const authOptions: NextAuthOptions = {
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/signin',
  },
  providers: buildProviders(),
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account || account.provider === 'credentials') {
        // Password sign-in can be a brand-new user's first successful session
        // (registration is best-effort above), so provision here too.
        if (user.id) await ensureWorkspaceForSignIn(user.id, user.name);
        return true;
      }
      const email = user.email?.trim().toLowerCase();
      if (!email) return false;

      // Providers that assert verification must assert it. Google always sets
      // email_verified; GitHub's default profile omits it, so absence is not
      // treated as a failure.
      const providerEmailVerified = (profile as { email_verified?: unknown } | undefined)
        ?.email_verified;
      if (providerEmailVerified === false) return '/auth/signin?error=EmailNotVerified';

      const db = getDb();
      const existing = await db.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });
      if (existing) {
        if (!canAdoptAccountByEmail(existing)) {
          // Do not sign the user in under an existing password-protected
          // account, and do not create a duplicate row for the same address.
          return '/auth/signin?error=AccountLinkRequired';
        }
        user.id = existing.id;
        user.email = existing.email;
        // Carry the database-minted version so getVerifiedSession can compare
        // it: an OAuth login must not re-mint a token that starts back at 0.
        user.sessionVersion = existing.sessionVersion;
        // Existing rows may predate onboarding, and an adopted OAuth identity
        // still needs a workspace it can create projects in.
        await ensureWorkspaceForSignIn(existing.id, existing.name ?? user.name);
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
      user.sessionVersion = created.sessionVersion;
      await ensureWorkspaceForSignIn(created.id, created.name ?? user.name);
      return true;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
        // Carried so server code can compare it against the database and treat
        // a stale token as signed out (see getVerifiedSession).
        session.user.sessionVersion = token.sessionVersion ?? 0;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.sessionVersion = (user as { sessionVersion?: number }).sessionVersion ?? 0;
      }
      return token;
    },
  },
};

/**
 * Resolve the signed-in user for a server request, rejecting tokens that were
 * issued before the account's `sessionVersion` was bumped (password reset,
 * "sign out everywhere"). A JWT is self-contained, so without this check a
 * stolen or leaked token keeps working for its full 30-day lifetime.
 *
 * Returns null when there is no valid session, which callers treat exactly like
 * being signed out.
 */
export async function getVerifiedSession(): Promise<Session | null> {
  const session = await getServerSession(authOptions);
  const user = session?.user as (Session['user'] & { sessionVersion?: number }) | undefined;
  if (!session || !user?.id) return null;

  const dbUser = await getDb().user.findUnique({
    where: { id: user.id },
    select: { sessionVersion: true },
  });
  if (!dbUser) return null;

  return dbUser.sessionVersion === (user.sessionVersion ?? 0) ? session : null;
}
