import { z } from 'zod';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { TRPCError } from '@trpc/server';
import { publicProcedure, protectedProcedure, router } from '../trpc';
import { checkRateLimit } from '@/server/rate-limit';
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
      const identity = process.env.TRUSTED_PROXY === 'true' ? `${ctx.ipHash}:${email}` : email;
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
      const identity = process.env.TRUSTED_PROXY === 'true' ? `${ctx.ipHash}:${email}` : email;
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
      const rate = await checkRateLimit('passwordReset', ctx.ipHash);
      if (!rate.allowed) {
        const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Too many reset requests. Try again in ${retryIn}s.`,
        });
      }

      const email = input.email.trim().toLowerCase();
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
        } else if (process.env.NODE_ENV !== 'production') {
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
      const passwordHash = await bcrypt.hash(input.password, 12);
      await ctx.db.$transaction(async (tx) => {
        const record = await tx.passwordResetToken.findUnique({
          where: { token: tokenHash },
        });
        if (!record || record.usedAt || record.expiresAt < new Date()) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This reset link is invalid or has expired.',
          });
        }

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
