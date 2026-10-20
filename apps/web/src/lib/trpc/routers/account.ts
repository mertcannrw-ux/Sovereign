import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@prisma-generated/prisma/client';
import { protectedProcedure, publicProcedure, router } from '../trpc';
import type { Context } from '../context';
import { oauthProvidersEnabled } from '@/lib/auth';
import { canRemoveSignInMethod } from '@/lib/account-linking';
import {
  LINKABLE_PROVIDERS,
  LINK_COOKIE,
  LINK_TTL_SECONDS,
  encodeLinkIntent,
} from '@/server/account-link';
import { appUrl, isEmailConfigured, sendEmail } from '@/server/email';
import { checkRateLimit, type RateLimitKey } from '@/server/rate-limit';
import { assertTenantSchemaName } from '@/server/app-database';
import { quotePgIdent } from '@/server/db-browser';
import { deploySubdomain, isDeployConfigured, unpublishBundle } from '@/server/deploy/user-apps';

// ─── Helpers ──────────────────────────────────────────────

const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000;

/** Decoded avatar ceiling. The client sends a 256px crop, well under this. */
const MAX_AVATAR_BYTES = 256 * 1024;

const providerSchema = z.enum(LINKABLE_PROVIDERS);

async function enforceRateLimit(key: RateLimitKey, identity: string, message: string) {
  const rate = await checkRateLimit(key, identity);
  if (!rate.allowed) {
    const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 60_000));
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: `${message} Try again in ${retryIn} min.`,
    });
  }
}

async function loadUser(ctx: Context & { user: { id: string } }) {
  const user = await ctx.db.user.findUnique({ where: { id: ctx.user.id } });
  if (!user) throw new TRPCError({ code: 'UNAUTHORIZED' });
  return user;
}

async function assertPassword(passwordHash: string | null, password: string | undefined) {
  if (!passwordHash) return;
  if (!password || !(await bcrypt.compare(password, passwordHash))) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: "That password isn't right." });
  }
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** The image type from its first bytes; the declared type is not trusted. */
function sniffImage(bytes: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return 'image/png';
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

const ACTIVE_SUBSCRIPTION = ['ACTIVE', 'TRIALING', 'PAST_DUE'] as const;

// ─── Router ───────────────────────────────────────────────

export const accountRouter = router({
  /**
   * Everything Settings > Profile shows.
   */
  get: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.user.id },
      select: {
        email: true,
        name: true,
        avatarUrl: true,
        pendingEmail: true,
        passwordHash: true,
        mascotAnimations: true,
        accounts: { select: { provider: true } },
      },
    });
    if (!user) throw new TRPCError({ code: 'UNAUTHORIZED' });

    const enabled = oauthProvidersEnabled();
    const connected = new Set(user.accounts.map((account) => account.provider));
    return {
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      pendingEmail: user.pendingEmail,
      hasPassword: user.passwordHash !== null,
      mascotAnimations: user.mascotAnimations,
      // Providers this deployment supports, plus any still connected after
      // being switched off, so they can be disconnected.
      providers: LINKABLE_PROVIDERS.filter((id) => enabled[id] || connected.has(id)).map((id) => ({
        id,
        enabled: enabled[id],
        connected: connected.has(id),
      })),
    };
  }),

  /** Just the preferences, for app-wide consumers. */
  preferences: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db.user.findUnique({
      where: { id: ctx.user.id },
      select: { mascotAnimations: true },
    });
    return { mascotAnimations: user?.mascotAnimations ?? true };
  }),

  updatePreferences: protectedProcedure
    .input(z.object({ mascotAnimations: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.user.update({ where: { id: ctx.user.id }, data: input });
      return input;
    }),

  updateName: protectedProcedure
    .input(
      z.object({
        name: z
          .string()
          .trim()
          .min(1, 'Enter a name.')
          .max(100, 'Keep your name under 100 characters.'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.user.update({ where: { id: ctx.user.id }, data: { name: input.name } });
      return { name: input.name };
    }),

  /**
   * Store an uploaded avatar. The client crops it to a square and sends it as
   * base64; it is served from /api/avatar/[id].
   */
  setAvatar: protectedProcedure
    .input(z.object({ image: z.string().max(Math.ceil((MAX_AVATAR_BYTES * 4) / 3) + 4) }))
    .mutation(async ({ ctx, input }) => {
      const bytes = Buffer.from(input.image, 'base64');
      const mime = sniffImage(bytes);
      if (!mime || bytes.length > MAX_AVATAR_BYTES) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Use a PNG, JPEG or WebP image.',
        });
      }
      // Versioned so browsers drop the cached previous image.
      const avatarUrl = `/api/avatar/${ctx.user.id}?v=${Date.now().toString(36)}`;
      await ctx.db.user.update({
        where: { id: ctx.user.id },
        data: { avatarImage: bytes, avatarMime: mime, avatarUrl },
      });
      return { avatarUrl };
    }),

  removeAvatar: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.user.update({
      where: { id: ctx.user.id },
      data: { avatarImage: null, avatarMime: null, avatarUrl: null },
    });
    return { ok: true as const };
  }),

  /**
   * Start an email change: the new address gets a confirmation link and the
   * current one keeps working until it is opened.
   */
  requestEmailChange: protectedProcedure
    .input(
      z.object({
        email: z.string().email('Enter a valid email address.'),
        password: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await enforceRateLimit('emailChange', ctx.user.id, 'Too many email changes.');
      const user = await loadUser(ctx);
      const email = input.email.trim().toLowerCase();

      if (email === user.email.toLowerCase()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: "That's already your email." });
      }
      await assertPassword(user.passwordHash, input.password);
      if (process.env.NODE_ENV === 'production' && !isEmailConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "Email isn't set up on this server, so the address can't be changed yet.",
        });
      }
      const taken = await ctx.db.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true },
      });
      if (taken) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'Another account already uses that email.',
        });
      }

      const rawToken = crypto.randomBytes(32).toString('hex');
      await ctx.db.$transaction([
        // One pending change at a time: a newer request voids older links.
        ctx.db.emailVerificationToken.deleteMany({
          where: { userId: user.id, email: { not: null } },
        }),
        ctx.db.emailVerificationToken.create({
          data: {
            userId: user.id,
            email,
            token: hashToken(rawToken),
            expiresAt: new Date(Date.now() + EMAIL_CHANGE_TTL_MS),
          },
        }),
        ctx.db.user.update({ where: { id: user.id }, data: { pendingEmail: email } }),
      ]);

      const confirmUrl = appUrl(`/auth/confirm-email?token=${rawToken}`);
      const sent = await sendEmail({
        to: email,
        subject: 'Confirm your new Sovereign email',
        html: `<p>Confirm that you want to use this address for your Sovereign account:</p><p><a href="${confirmUrl}">${confirmUrl}</a></p><p>This link expires in 24 hours. If you didn't ask for this, ignore this email.</p>`,
        devLink: confirmUrl,
      });
      if (!sent) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: "We couldn't send the confirmation email. Try again later.",
        });
      }
      return { pendingEmail: email };
    }),

  cancelEmailChange: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.$transaction([
      ctx.db.emailVerificationToken.deleteMany({
        where: { userId: ctx.user.id, email: { not: null } },
      }),
      ctx.db.user.update({ where: { id: ctx.user.id }, data: { pendingEmail: null } }),
    ]);
    return { ok: true as const };
  }),

  /**
   * Opened from the confirmation link, possibly on another device, so the
   * token alone identifies the change.
   */
  confirmEmailChange: publicProcedure
    .input(z.object({ token: z.string().min(16) }))
    .mutation(async ({ ctx, input }) => {
      const tokenHash = hashToken(input.token);
      await enforceRateLimit(
        'emailConfirm',
        `${ctx.ipHash}:${tokenHash.slice(0, 16)}`,
        'Too many attempts.',
      );

      const invalid = new TRPCError({
        code: 'BAD_REQUEST',
        message: 'This link is invalid or has expired. Request the change again from Settings.',
      });
      const record = await ctx.db.emailVerificationToken.findUnique({
        where: { token: tokenHash },
        include: { user: { select: { email: true, pendingEmail: true } } },
      });
      if (!record?.email || record.expiresAt < new Date()) throw invalid;
      if (record.user.pendingEmail !== record.email) throw invalid;
      const previousEmail = record.user.email;

      try {
        await ctx.db.$transaction(async (tx) => {
          const consumed = await tx.emailVerificationToken.deleteMany({ where: { id: record.id } });
          if (consumed.count !== 1) throw invalid;
          await tx.emailVerificationToken.deleteMany({
            where: { userId: record.userId, email: { not: null } },
          });
          await tx.user.update({
            where: { id: record.userId },
            data: { email: record.email!, pendingEmail: null, emailVerified: true },
          });
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Another account started using that email. Pick a different one.',
          });
        }
        throw error;
      }

      // Best-effort heads-up to the old address, in case this wasn't them.
      void sendEmail({
        to: previousEmail,
        subject: 'Your Sovereign email was changed',
        html: `<p>The email for your Sovereign account is now ${escapeHtml(record.email)}.</p><p>If you didn't do this, reset your password right away.</p>`,
      });
      return { email: record.email };
    }),

  /**
   * Mark the next OAuth round trip for `provider` as "connect to this account"
   * (see server/account-link.ts). The client then calls next-auth's signIn.
   */
  beginConnect: protectedProcedure
    .input(z.object({ provider: providerSchema }))
    .mutation(async ({ ctx, input }) => {
      if (!oauthProvidersEnabled()[input.provider]) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "That provider isn't available right now.",
        });
      }
      const secret = process.env.NEXTAUTH_SECRET;
      if (!secret) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      const value = encodeLinkIntent(
        {
          userId: ctx.user.id,
          provider: input.provider,
          expiresAt: Date.now() + LINK_TTL_SECONDS * 1000,
        },
        secret,
      );
      (await cookies()).set(LINK_COOKIE, value, {
        httpOnly: true,
        // The provider returns with a top-level GET, which `lax` allows.
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/api/auth',
        maxAge: LINK_TTL_SECONDS,
      });
      return { ok: true as const };
    }),

  disconnectProvider: protectedProcedure
    .input(z.object({ provider: providerSchema }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: ctx.user.id },
          select: { passwordHash: true, accounts: { select: { id: true, provider: true } } },
        });
        if (!user) throw new TRPCError({ code: 'UNAUTHORIZED' });
        const account = user.accounts.find((a) => a.provider === input.provider);
        if (!account) return;
        if (
          !canRemoveSignInMethod({
            hasPassword: user.passwordHash !== null,
            linkedAccounts: user.accounts.length,
          })
        ) {
          throw new TRPCError({
            code: 'PRECONDITION_FAILED',
            message: 'This is your only way to sign in. Connect another one first.',
          });
        }
        await tx.account.delete({ where: { id: account.id } });
      });
      return { ok: true as const };
    }),

  /**
   * Change the password and sign out every other session. The caller re-signs
   * in with the new password to get a fresh token.
   */
  changePassword: protectedProcedure
    .input(
      z.object({
        currentPassword: z.string().min(1, 'Enter your current password.'),
        newPassword: z
          .string()
          .min(8, 'Use at least 8 characters.')
          .max(200, 'Keep it under 200 characters.'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await enforceRateLimit('passwordChange', ctx.user.id, 'Too many attempts.');
      const user = await loadUser(ctx);
      if (!user.passwordHash) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: "This account doesn't use a password.",
        });
      }
      if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "Your current password isn't right.",
        });
      }
      const passwordHash = await bcrypt.hash(input.newPassword, 12);
      await ctx.db.$transaction([
        ctx.db.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        }),
        ctx.db.user.update({
          where: { id: user.id },
          data: { passwordHash, sessionVersion: { increment: 1 } },
        }),
      ]);
      return { email: user.email };
    }),

  /** Invalidate every session, this one included (see getVerifiedSession). */
  signOutEverywhere: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.db.user.update({
      where: { id: ctx.user.id },
      data: { sessionVersion: { increment: 1 } },
    });
    return { ok: true as const };
  }),

  /**
   * What deleting the account removes, for the confirmation dialog: the
   * projects in Realms they own. Projects they made in other people's Realms
   * stay there.
   */
  deletionSummary: protectedProcedure.query(async ({ ctx }) => {
    const owned = { realm: { ownerId: ctx.user.id } };
    const [projects, liveApps, apiKeys] = await Promise.all([
      ctx.db.project.count({ where: owned }),
      ctx.db.project.count({ where: { ...owned, status: 'PUBLISHED' } }),
      ctx.db.apiKey.count({ where: { userId: ctx.user.id } }),
    ]);
    return { projects, liveApps, apiKeys };
  }),

  /**
   * Permanently delete the account: the Realms they own (none of which may have
   * other members), with their projects, app databases and live apps, and the
   * keys they added. Projects they made in other people's Realms stay there.

   */
  deleteAccount: protectedProcedure
    .input(z.object({ email: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const user = await loadUser(ctx);
      if (input.email.trim().toLowerCase() !== user.email.toLowerCase()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: "That doesn't match your account email.",
        });
      }

      const ownedRealms = await ctx.db.realm.findMany({
        where: { ownerId: user.id },
        select: {
          id: true,
          name: true,
          subscriptions: { select: { status: true, cancelAtPeriodEnd: true } },
          _count: { select: { members: { where: { userId: { not: user.id } } } } },
        },
      });
      const shared = ownedRealms.find((realm) => realm._count.members > 0);
      if (shared) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `You own the Realm "${shared.name}", which has other members. Transfer it to someone else first.`,
        });
      }
      const paying = ownedRealms.some((realm) =>
        realm.subscriptions.some(
          (sub) =>
            (ACTIVE_SUBSCRIPTION as readonly string[]).includes(sub.status) &&
            !sub.cancelAtPeriodEnd,
        ),
      );
      if (paying) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Cancel your subscription in Billing first, so you are not charged again.',
        });
      }

      const realmIds = ownedRealms.map((realm) => realm.id);
      const projects = await ctx.db.project.findMany({
        where: { realmId: { in: realmIds } },
        select: {
          id: true,
          slug: true,
          status: true,
          databases: { select: { schemaName: true } },
        },
      });

      // Take live apps offline before the rows that point at them are gone.
      const live = projects.filter((project) => project.status === 'PUBLISHED');
      if (live.length > 0 && isDeployConfigured()) {
        try {
          await Promise.all(live.map((project) => unpublishBundle(deploySubdomain(project))));
        } catch (error) {
          console.error('[account] failed to unpublish apps before deletion', error);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: "We couldn't take your live apps offline. Nothing was deleted. Try again.",
          });
        }
      }

      await ctx.db.$transaction(
        async (tx) => {
          for (const project of projects) {
            // Tenant schemas hold end users' data and outlive the project row.
            for (const database of project.databases) {
              const schemaName = assertTenantSchemaName(database.schemaName);
              await tx.$executeRawUnsafe(
                `DROP SCHEMA IF EXISTS ${quotePgIdent(schemaName)} CASCADE`,
              );
            }
          }
          await tx.project.deleteMany({ where: { id: { in: projects.map((p) => p.id) } } });

          // Mirrors realms.delete for the Realms only they belong to.
          await tx.auditEvent.deleteMany({ where: { realmId: { in: realmIds } } });
          await tx.usageLedger.deleteMany({ where: { realmId: { in: realmIds } } });
          await tx.subscription.deleteMany({ where: { realmId: { in: realmIds } } });
          await tx.entitlement.deleteMany({ where: { realmId: { in: realmIds } } });
          await tx.backgroundJob.deleteMany({ where: { realmId: { in: realmIds } } });
          await tx.realm.deleteMany({ where: { id: { in: realmIds } } });

          // Their projects in other people's Realms belong to those Realms;
          // hand them to each Realm's owner so the account delete cannot take
          // them along.
          const elsewhere = await tx.project.findMany({
            where: { ownerId: user.id },
            select: { id: true, realm: { select: { ownerId: true } } },
          });
          for (const project of elsewhere) {
            await tx.project.update({
              where: { id: project.id },
              data: { ownerId: project.realm.ownerId },
            });
          }

          // History in other Realms stays, without the person behind it.
          await tx.auditEvent.updateMany({ where: { actorId: user.id }, data: { actorId: null } });
          await tx.backgroundJob.updateMany({
            where: { actorId: user.id },
            data: { actorId: null },
          });
          await tx.realmInvite.deleteMany({ where: { invitedById: user.id } });

          await tx.user.delete({ where: { id: user.id } });
        },
        { timeout: 30_000 },
      );

      return { ok: true as const };
    }),
});
