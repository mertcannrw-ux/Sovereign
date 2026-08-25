import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { TRPCError } from '@trpc/server';
import { publicProcedure, protectedProcedure, router } from '../trpc';
import { checkRateLimit } from '@/server/rate-limit';

export const authRouter = router({
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
      const rate = await checkRateLimit('register', ctx.ipHash);
      if (!rate.allowed) {
        const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Too many sign-ups. Try again in ${retryIn}s.`,
        });
      }

      const email = input.email.trim().toLowerCase();
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
      const rate = await checkRateLimit('signIn', ctx.ipHash);
      if (!rate.allowed) {
        const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Too many sign-in attempts. Try again in ${retryIn}s.`,
        });
      }

      const email = input.email.trim().toLowerCase();
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
});
