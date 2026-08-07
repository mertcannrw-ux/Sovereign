import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { TRPCError } from '@trpc/server';
import { publicProcedure, protectedProcedure, router } from '../trpc';

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
      const existing = await ctx.db.user.findUnique({
        where: { email: input.email },
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
          email: input.email,
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
      const user = await ctx.db.user.findUnique({
        where: { email: input.email },
      });
      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Invalid email or password',
        });
      }

      if (!user.passwordHash) {
        throw new TRPCError({
          code: 'NOT_FOUND',
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
