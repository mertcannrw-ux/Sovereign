import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { publicProcedure, protectedProcedure, router } from '../trpc';
import { checkRateLimit } from '@/server/rate-limit';
import { ensurePersonalRealm } from '@/server/onboarding';
import { oauthProvidersEnabled } from '@/lib/auth';
import { appUrl, isEmailConfigured, sendEmail } from '@/server/email';

export const authRouter = router({
  providers: publicProcedure.query(() => oauthProvidersEnabled()),

  /**
   * Register a new user with email and password.
   * Creates a User record with the bcrypt-hashed password stored
   * directly on the user record (passwordHash).
   */
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email().max(254),
        password: z.string().min(8).max(200),
        name: z.string().min(1).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      // Bucket per IP+email. `ctx.ipHash` is a constant (127.0.0.1) when no
      // trusted proxy is configured, so this degrades to per-email keying
      // rather than one global bucket shared by every user.
      const identity = `${ctx.ipHash}:${email}`;
      const rate = await checkRateLimit('register', identity);
      if (!rate.allowed) {
        const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Too many sign-ups. Try again in ${retryIn}s.`,
        });
      }

      const existing = await ctx.db.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });
      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A user with this email already exists',
        });
      }

      const hashedPassword = await bcrypt.hash(input.password, 12);

      const user = await ctx.db.user.create({
        data: {
          email,
          name: input.name ?? null,
          passwordHash: hashedPassword,
        },
      });

      try {
        // A fresh account has no Realm and projects.create requires one, so
        // without this the new user has nowhere to build.
        // Best-effort: the account already exists, so failing here must not turn
        // a successful signup into an error. The idempotent version in the
        // sign-in callback repairs the account on the next successful login.
        await ensurePersonalRealm(ctx.db, user.id, ctx.ipHash);
      } catch (error) {
        console.error('[auth] failed to provision personal Realm for new user', error);
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
      };
    }),

  /**
   * Returns the current session and user for the authenticated caller.
   */
  getSession: protectedProcedure.query(({ ctx }) => ({
    user: ctx.user,
    expires: ctx.session?.expires,
  })),

  requestPasswordReset: publicProcedure
    .input(z.object({ email: z.string().email().max(254) }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      // Bucket per IP+email: `ctx.ipHash` is constant without a trusted proxy,
      // so this degrades to per-email keying instead of one shared bucket.
      const identity = `${ctx.ipHash}:${email}`;
      const rate = await checkRateLimit('passwordReset', identity);
      if (!rate.allowed) {
        const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Too many reset requests. Try again in ${retryIn}s.`,
        });
      }

      // Check the mailer BEFORE touching the user record. Throwing only for
      // registered password accounts (the branch below) would turn a missing
      // RESEND_API_KEY into an account-existence oracle: every registered
      // password account 500s while every other address returns ok:true.
      // Failing uniformly for all inputs keeps the enumeration signal gone
      // while still surfacing the misconfiguration loudly.
      if (process.env.NODE_ENV === 'production' && !isEmailConfigured()) {
        console.error(
          '[auth] password reset requested but RESEND_API_KEY/EMAIL_FROM are not configured',
        );
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Password reset is not available. Contact support.',
        });
      }

      const user = await ctx.db.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });

      if (user?.passwordHash) {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        await ctx.db.$transaction([
          ctx.db.passwordResetToken.updateMany({
            where: { userId: user.id, usedAt: null },
            data: { usedAt: new Date() },
          }),
          ctx.db.passwordResetToken.create({
            data: {
              userId: user.id,
              token: tokenHash,
              expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            },
          }),
        ]);

        const resetUrl = appUrl(`/auth/reset-password?token=${rawToken}`);
        const sent = await sendEmail({
          to: email,
          subject: 'Reset your Sovereign password',
          html: `<p>Reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour.</p>`,
          devLink: resetUrl,
        });
        if (!sent && process.env.NODE_ENV === 'production') {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Could not send the reset email. Try again later.',
          });
        }
      }

      return { ok: true as const };
    }),

  resetPassword: publicProcedure
    .input(
      z.object({
        token: z.string().min(16).max(256),
        password: z.string().min(8).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tokenHash = crypto.createHash('sha256').update(input.token).digest('hex');
      // Gate the endpoint before the expensive work: an unauthenticated caller
      // could otherwise burn a cost-12 bcrypt hash on every fabricated token.
      // Key on the client only. Deriving the key from the presented token let
      // any caller mint a fresh bucket per guess, which made the limit
      // decorative; 32 random bytes make guessing infeasible anyway, so this
      // budget exists to bound the endpoint, not to protect the token.
      const identity = ctx.ipHash;
      const rate = await checkRateLimit('passwordResetSubmit', identity);
      if (!rate.allowed) {
        const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Too many reset attempts. Try again in ${retryIn}s.`,
        });
      }

      const record = await ctx.db.passwordResetToken.findUnique({
        where: { token: tokenHash },
      });
      if (!record || record.usedAt || record.expiresAt < new Date()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This reset link is invalid or has expired.',
        });
      }

      const passwordHash = await bcrypt.hash(input.password, 12);
      await ctx.db.$transaction(async (tx) => {
        // Consume before writing: the conditional update keeps the token
        // single-use even when two requests with the same valid token race past
        // the lookup above.
        const consumed = await tx.passwordResetToken.updateMany({
          where: { id: record.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (consumed.count !== 1) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This reset link is invalid or has expired.',
          });
        }

        await tx.passwordResetToken.updateMany({
          where: { userId: record.userId, usedAt: null, id: { not: record.id } },
          data: { usedAt: new Date() },
        });

        // Bumping sessionVersion invalidates every JWT issued before this reset,
        // so a stolen token cannot outlive the password change.
        await tx.user.update({
          where: { id: record.userId },
          data: { passwordHash, sessionVersion: { increment: 1 } },
        });
      });

      return { ok: true as const };
    }),
});
