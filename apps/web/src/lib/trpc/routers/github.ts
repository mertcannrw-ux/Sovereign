import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc';
import { canRemoveSignInMethod } from '@/lib/account-linking';

export const githubRouter = router({
  // Note: a `connect` mutation that stored a user's personal access token was
  // removed - the token was never read by any code (the GitHub App integration
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
      // next-auth's GitHub provider stores the numeric profile id here; `login`
      // is never persisted, so do not present it as a username.
      githubUserId: account.providerAccountId,
      scope: account.scope ?? null,
    };
  }),

  /**
   * Disconnect GitHub by removing the stored account record. Refuses when it is
   * the caller's only way to sign in - the same guard `account.disconnectProvider`
   * applies.
   */
  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    const [account, user, linkedAccounts] = await Promise.all([
      ctx.db.account.findFirst({
        where: { userId: ctx.user.id, provider: 'github' },
      }),
      ctx.db.user.findUnique({
        where: { id: ctx.user.id },
        select: { passwordHash: true },
      }),
      ctx.db.account.count({ where: { userId: ctx.user.id } }),
    ]);

    if (!account) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'No GitHub connection found',
      });
    }

    if (
      !canRemoveSignInMethod({
        hasPassword: Boolean(user?.passwordHash),
        linkedAccounts,
      })
    ) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'GitHub is your only sign-in method. Add a password before disconnecting it.',
      });
    }

    await ctx.db.account.delete({ where: { id: account.id } });

    return { success: true as const };
  }),
});
