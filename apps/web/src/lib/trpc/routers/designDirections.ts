import { z } from 'zod';
import { protectedProcedure, router } from '../trpc';
import { requireProjectRole } from '@/server/authz';

export const designDirectionsRouter = router({
  /**
   * Get the active design direction set for a project. Returns the most recent
   * set that is still awaiting the user's choice (pending or ready) so the cards
   * survive a page reload between generation completing and the user selecting.
   */
  getActive: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProjectRole(ctx, input.projectId, 'VIEWER');
      const activeSet = await ctx.db.designDirectionSet.findFirst({
        where: {
          projectId: input.projectId,
          status: { in: ['pending', 'ready'] },
        },
        orderBy: { createdAt: 'desc' },
        include: {
          directions: {
            orderBy: { orderNumber: 'asc' },
            include: { previewAsset: true },
          },
        },
      });

      return activeSet;
    }),
});
