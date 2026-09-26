import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { publicProcedure, protectedProcedure, router } from '../trpc';
import { checkRateLimit } from '@/server/rate-limit';
import { ensurePersonalOrganization } from '@/server/onboarding';
import { oauthProvidersEnabled } from '@/lib/auth';
import { env } from '@/env';

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
        email: z.string().email(),
        password: z.string().min(8),
        name: z.string().min(1).max(100).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      // Bucket per IP+email so a missing trusted-proxy header (every request
      // seen as 127.0.0.1) can never collapse registration into ONE global
      // bucket shared by all users.
      const identity = env.TRUSTED_PROXY ? `${ctx.ipHash}:${email}` : email;
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
        // A fresh account owns no organization and projects.create requires one,
        // so without this the new user dead-ends at "No workspace found".
        // Best-effort: the account already exists, so failing here must not turn
        // a successful signup into an error. The idempotent version in the
        // sign-in callback repairs the account on the next successful login.
        await ensurePersonalOrganization(ctx.db, user.id, user.name, ctx.ipHash);
      } catch (error) {
        console.error('[auth] failed to provision personal organization for new user', error);
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
      };
    }),

  /**
   * Sign in with email and password.
   * Verifies credentials and returns the user profile.
   * (Session tokens are handled client-side via NextAuth signIn.)
   */
  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      // Bucket per IP+email (see register): without a trusted proxy header the
      // fallback is per-email, never one shared global bucket.
      const identity = env.TRUSTED_PROXY ? `${ctx.ipHash}:${email}` : email;
      const rate = await checkRateLimit('signIn', identity);
      if (!rate.allowed) {
        const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Too many sign-in attempts. Try again in ${retryIn}s.`,
        });
      }

      const user = await ctx.db.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });
      if (!user || !user.passwordHash) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        });
      }

      const isValid = await bcrypt.compare(input.password, user.passwordHash);
      if (!isValid) {
        throw new TRPCError({
          code: 'UNAUTHORIZED',
          message: 'Invalid email or password',
        });
      }

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
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
    .input(z.object({ email: z.string().email() }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.trim().toLowerCase();
      // Bucket per IP+email (see register). Keying on `ctx.ipHash` alone would
      // put every caller behind one bucket whenever no trusted proxy header is
      // present (getClientIp returns a constant 127.0.0.1), so a single
      // anonymous attacker could exhaust the shared limit and block password
      // resets for all users.
      const identity = env.TRUSTED_PROXY ? `${ctx.ipHash}:${email}` : email;
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
      if (process.env.NODE_ENV === 'production' && !(env.RESEND_API_KEY && env.EMAIL_FROM)) {
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

        const baseUrl = env.NEXTAUTH_URL ?? env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
        const resetUrl = `${baseUrl.replace(/\/+$/, '')}/auth/reset-password?token=${rawToken}`;

        if (env.RESEND_API_KEY && env.EMAIL_FROM) {
          let sent = false;
          try {
            const response = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: env.EMAIL_FROM,
                to: email,
                subject: 'Reset your Sovereign password',
                html: `<p>Reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour.</p>`,
              }),
            });
            sent = response.ok;
            if (!sent) {
              console.error('[auth] password reset email rejected', response.status);
            }
          } catch (error) {
            console.error('[auth] failed to send password reset email', error);
          }
          if (!sent && process.env.NODE_ENV === 'production') {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Could not send the reset email. Try again later.',
            });
          }
        } else {
          // Non-production with the mailer unconfigured: log the link so the
          // reset flow stays usable locally. Production is rejected above.
          console.info('[auth] password reset URL (email not configured):', resetUrl);
        }
      }

      return { ok: true as const };
    }),

  resetPassword: publicProcedure
    .input(
      z.object({
        token: z.string().min(16),
        password: z.string().min(8),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tokenHash = crypto.createHash('sha256').update(input.token).digest('hex');
      // Gate the endpoint before the expensive work: an unauthenticated caller
      // could otherwise burn a cost-12 bcrypt hash on every fabricated token.
      // There is no email/account input here, so the token itself is the only
      // meaningful identity. Under a trusted proxy we can additionally separate
      // callers by IP; without one every request is seen as 127.0.0.1, so the
      // key must stay a single shared bucket (never per-request, which would
      // let a caller reset the limiter at will). Using the token hash prefix —
      // not the raw token — also keeps tokens out of rate-limit keys/logs, and
      // the 20/15min budget is unchanged in both modes.
      const identity = env.TRUSTED_PROXY ? `${ctx.ipHash}:${tokenHash.slice(0, 16)}` : 'global';
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
