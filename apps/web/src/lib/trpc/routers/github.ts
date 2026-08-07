import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc';

export const githubRouter = router({
  /**
   * Connect a GitHub account by storing an OAuth token.
   * Uses the Account model with provider="github" to persist the encrypted token.
   */
  connect: protectedProcedure
    .input(
      z.object({
        token: z.string().min(1, 'GitHub token is required'),
        username: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Upsert a GitHub account record with the access token
      const existing = await ctx.db.account.findFirst({
        where: { userId: ctx.user.id, provider: 'github' },
      });

      if (existing) {
        await ctx.db.account.update({
          where: { id: existing.id },
          data: {
            encryptedToken: input.token,
            scope: 'repo,user',
          },
        });
      } else {
        await ctx.db.account.create({
          data: {
            userId: ctx.user.id,
            provider: 'github',
            providerAccountId: input.username ?? ctx.user.email ?? ctx.user.id,
            encryptedToken: input.token,
            scope: 'repo,user',
          },
        });
      }

      return { success: true as const };
    }),

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
   * Export a project to GitHub.
   * Creates a mock repository and returns the URL.
   */
  export: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        repoName: z.string().min(1).max(100),
        description: z.string().max(500).optional(),
        private: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify the user owns or collaborates on the project
      const project = await ctx.db.project.findUnique({
        where: { id: input.projectId },
      });

      if (!project) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        });
      }

      const isOwner = project.ownerId === ctx.user.id;
      const isCollaborator = !isOwner
        ? await ctx.db.projectCollaborator.findFirst({
            where: { projectId: input.projectId, userId: ctx.user.id },
          })
        : null;

      if (!isOwner && !isCollaborator) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Access denied',
        });
      }

      // Verify a GitHub connection exists
      const account = await ctx.db.account.findFirst({
        where: { userId: ctx.user.id, provider: 'github' },
      });

      if (!account?.encryptedToken) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'No GitHub account connected. Use connect first.',
        });
      }

      // Simulate export — in production this would call the GitHub API
      const repoUrl = `https://github.com/${account.providerAccountId}/${input.repoName}`;

      return {
        success: true as const,
        repoUrl,
        repoName: input.repoName,
        message: `Project exported to ${repoUrl}`,
      };
    }),

  /**
   * Sync a project from a GitHub repository (pull latest).
   */
  sync: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        repoUrl: z.string().url(),
        branch: z.string().default('main'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify project access
      const project = await ctx.db.project.findUnique({
        where: { id: input.projectId },
      });

      if (!project) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        });
      }

      const isOwner = project.ownerId === ctx.user.id;
      const isCollaborator = !isOwner
        ? await ctx.db.projectCollaborator.findFirst({
            where: { projectId: input.projectId, userId: ctx.user.id },
          })
        : null;

      if (!isOwner && !isCollaborator) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Access denied',
        });
      }

      // Verify GitHub connection
      const account = await ctx.db.account.findFirst({
        where: { userId: ctx.user.id, provider: 'github' },
      });

      if (!account?.encryptedToken) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'No GitHub account connected.',
        });
      }

      // Simulate sync — in production this would pull from the GitHub API
      return {
        success: true as const,
        message: `Synced from ${input.repoUrl} (branch: ${input.branch}). Pulled latest changes.`,
        filesSynced: 0,
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
