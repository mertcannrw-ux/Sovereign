import { NextAuthOptions, getServerSession, type Session } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import GitHubProvider from 'next-auth/providers/github';
import CredentialsProvider from 'next-auth/providers/credentials';
import { decode } from 'next-auth/jwt';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { getDb } from './db';
import { canAdoptAccountByEmail } from './account-linking';
import { checkRateLimit, hashIp, trustedClientIp } from '@/server/rate-limit';
import { ensurePersonalOrganization } from '@/server/onboarding';
import { LINK_COOKIE, decodeLinkIntent, type LinkIntent } from '@/server/account-link';

export function oauthProvidersEnabled(): { google: boolean; github: boolean } {
  return {
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
  };
}

function buildProviders(): NextAuthOptions['providers'] {
  const enabled = oauthProvidersEnabled();
  const providers: NextAuthOptions['providers'] = [];
  // `allowDangerousEmailAccountLinking` is deliberately NOT set. Password
  // sign-ups do not verify their address, so an attacker can register the
  // victim's address with a password they control; auto-linking an OAuth identity onto that row
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
        // next-auth hands `authorize` a plain header object rather than a
        // `Headers` instance; `trustedClientIp` accepts both shapes so this
        // path and tRPC's `createContext` resolve the same IP the same way.
        const ip = trustedClientIp(req.headers);
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
 * The pending "connect a provider" intent for `provider` (server/account-link.ts),
 * consumed so it applies to one round trip only. Null unless the browser's
 * session token is still valid and belongs to the user who asked.
 */
async function consumeLinkIntent(provider: string): Promise<LinkIntent | null> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  const jar = await cookies();
  const raw = jar.get(LINK_COOKIE)?.value;
  if (!raw) return null;
  try {
    jar.delete(LINK_COOKIE);
  } catch {
    // Read-only context; the cookie expires on its own.
  }
  const intent = decodeLinkIntent(raw, secret);
  if (!intent || intent.provider !== provider) return null;

  const sessionToken =
    jar.get('__Secure-next-auth.session-token')?.value ?? jar.get('next-auth.session-token')?.value;
  const token = sessionToken
    ? await decode({ token: sessionToken, secret }).catch(() => null)
    : null;
  if (!token || token.sub !== intent.userId) return null;
  const owner = await getDb().user.findUnique({
    where: { id: intent.userId },
    select: { sessionVersion: true },
  });
  return owner && owner.sessionVersion === (token.sessionVersion ?? 0) ? intent : null;
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
      const identity = { provider: account.provider, providerAccountId: account.providerAccountId };
      const linked = await db.account.findUnique({
        where: { provider_providerAccountId: identity },
      });

      // "Connect" from Settings > Profile. Returning a URL ends the round trip
      // without a new sign-in, so the session that asked stays as it was.
      const intent = await consumeLinkIntent(account.provider);
      if (intent) {
        if (linked) {
          return linked.userId === intent.userId
            ? `/settings?tab=profile&linked=${account.provider}`
            : '/settings?tab=profile&linkError=taken';
        }
        const sameProvider = await db.account.findFirst({
          where: { userId: intent.userId, provider: account.provider },
        });
        if (sameProvider) return '/settings?tab=profile&linkError=exists';
        await db.account.create({ data: { ...identity, userId: intent.userId } });
        return `/settings?tab=profile&linked=${account.provider}`;
      }

      if (linked) {
        const owner = await db.user.findUnique({ where: { id: linked.userId } });
        if (!owner) return false;
        user.id = owner.id;
        user.email = owner.email;
        user.name = owner.name;
        user.image = owner.avatarUrl;
        user.sessionVersion = owner.sessionVersion;
        await ensureWorkspaceForSignIn(owner.id, owner.name);
        return true;
      }

      const existing = await db.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        include: { _count: { select: { accounts: true } } },
      });
      if (existing) {
        if (!canAdoptAccountByEmail({ ...existing, linkedAccounts: existing._count.accounts })) {
          // Do not sign the user in under an existing account this provider is
          // not connected to, and do not create a duplicate row for the same
          // address.
          return existing.passwordHash
            ? '/auth/signin?error=AccountLinkRequired'
            : '/auth/signin?error=ProviderNotConnected';
        }
        await db.account.create({ data: { ...identity, userId: existing.id } });
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
          accounts: { create: identity },
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
    async jwt({ token, user, trigger }) {
      if (user) {
        token.sub = user.id;
        token.sessionVersion = (user as { sessionVersion?: number }).sessionVersion ?? 0;
      }
      // The client calls `update()` after a profile edit: refresh what the
      // sidebar shows. Never sessionVersion - a revoked token must not be able
      // to revive itself this way.
      if (trigger === 'update' && token.sub) {
        const fresh = await getDb().user.findUnique({
          where: { id: token.sub },
          select: { name: true, email: true, avatarUrl: true },
        });
        if (fresh) {
          token.name = fresh.name;
          token.email = fresh.email;
          token.picture = fresh.avatarUrl;
        }
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
