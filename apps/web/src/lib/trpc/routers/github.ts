import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc';

export const githubRouter = router({
  // Note: a `connect` mutation that stored a user's personal access token was
  // removed — the token was never read by any code (the GitHub App integration
  // in @/server/github authenticates via installation tokens), so it persisted
  // encrypted-but-unused secrets. Only status/disconnect remain.

  /**
   * Get the current GitHub connection status.
   */
  status: protectedProcedure.query(async ({ ctx }) => {
    const account = await ctx.db.account.findFirst({
      where: { userId: ctx.user.id, provider: 'github' },
    });

    if (!account) {
      return { connected: false as const };
    }

    return {
      connected: true as const,
      username: account.providerAccountId,
      scope: account.scope ?? null,
    };
  }),

  /**
   * Disconnect GitHub by removing the stored account record.
   */
  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    const account = await ctx.db.account.findFirst({
      where: { userId: ctx.user.id, provider: 'github' },
    });

    if (!account) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'No GitHub connection found',
      });
    }

    await ctx.db.account.delete({ where: { id: account.id } });

    return { success: true as const };
  }),
});
