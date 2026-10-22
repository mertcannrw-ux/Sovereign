import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc';
import { requireProjectAccess } from '@/server/authz';
import { getR2ConfigStatus } from '@/server/assets/r2';
import { listProjectAssets, deleteProjectAsset } from '@/server/assets/project-assets';

export const assetsRouter = router({
  /**
   * List assets for a project (requires VIEWER role).
   */
  list: protectedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return listProjectAssets(input.projectId);
    }),

  /**
   * Check asset storage & image generation capability status.
   *
   * Takes no projectId: the answer depends only on server configuration and the
   * caller's own image provider, so there is nothing project-scoped to
   * authorize. The previous optional projectId was accepted and then ignored.
   */
  getStatus: protectedProcedure.query(async ({ ctx }) => {
    const r2Status = getR2ConfigStatus();

    // Image providers belong to a Realm, so resolve through the caller's
    // memberships: a userId-only lookup disagreed with what builds actually use.
    const imageConfig = await ctx.db.imageProviderConfig.findFirst({
      where: {
        enabled: true,
        realm: { members: { some: { userId: ctx.user.id } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      isR2Configured: r2Status.isConfigured,
      storageMode: r2Status.storageMode,
      r2Reason: r2Status.reason,
      isImageProviderConfigured: Boolean(imageConfig),
      imageModel: imageConfig?.model ?? null,
    };
  }),

  /**
   * Delete an asset (requires EDITOR role).
   */
  delete: protectedProcedure
    .input(
      z.object({
        assetId: z.string().uuid(),
        projectId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      try {
        await deleteProjectAsset(input.assetId, input.projectId);
        return { success: true };
      } catch (err) {
        // Log the raw reason server-side but never leak internals to the client.
        console.error('Failed to delete project asset', err);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete asset',
        });
      }
    }),
});
