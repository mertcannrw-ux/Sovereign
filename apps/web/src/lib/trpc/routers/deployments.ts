import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc';
import type { Context } from '../context';
import type { ProjectRole } from '@app-builder/shared';
import { requireProjectRole } from '@/server/authz';
import { checkRateLimit } from '@/server/rate-limit';
import { Prisma } from '@prisma-generated/prisma/client';

async function assertProjectAccess(
  ctx: Context,
  projectId: string,
  minimumRole: ProjectRole = 'VIEWER',
): Promise<void> {
  await requireProjectRole(ctx, projectId, minimumRole);
}

export const deploymentsRouter = router({
  /**
   * List all deployments for a project.
   */
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId, 'VIEWER');

      const deployments = await ctx.db.deployment.findMany({
        where: { projectId: input.projectId },
        orderBy: { createdAt: 'desc' },
      });

      return deployments;
    }),

  /**
   * Trigger a new deployment for a project.
   * Simulates the build-deploy pipeline:
   *   1. Find the latest version number for the project
   *   2. Create a deployment record with status BUILDING
   *   3. Simulate a build delay, then mark as LIVE
   *   4. Update the project's publishedAt timestamp
   */
  deploy: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId, 'EDITOR');

      const rate = await checkRateLimit('deploy', ctx.user.id);
      if (!rate.allowed) {
        const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Deployment rate limit exceeded. Try again in ${retryIn}s.`,
        });
      }

      const project = await ctx.db.project.findUnique({
        where: { id: input.projectId },
      });

      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      // Retry loop for concurrent P2002 version race
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        attempts++;
        try {
          return await ctx.db.$transaction(async (tx) => {
            const latestDeployment = await tx.deployment.findFirst({
              where: { projectId: input.projectId },
              orderBy: { version: 'desc' },
            });

            const nextVersion = (latestDeployment?.version ?? 0) + 1;
            const deploymentUrl = `https://stub.localhost/${project.slug}/v${nextVersion}`;
            const now = new Date();

            const buildSteps = [
              `[${now.toISOString()}] Local stub — Vercel deploy is not connected.`,
              `[${now.toISOString()}] Recorded placeholder deployment v${nextVersion}.`,
              `[${now.toISOString()}] URL ${deploymentUrl} is not a live host.`,
            ];

            const deployment = await tx.deployment.create({
              data: {
                projectId: input.projectId,
                version: nextVersion,
                status: 'LIVE',
                url: deploymentUrl,
                buildLogs: buildSteps.join('\n') + '\n',
                deployedAt: now,
              },
            });

            await tx.project.update({
              where: { id: input.projectId },
              data: { publishedAt: now, status: 'PUBLISHED' },
            });

            return { ...deployment, stub: true as const };
          });
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002' &&
            attempts < maxAttempts
          ) {
            continue;
          }
          throw err;
        }
      }

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create deployment due to high concurrency. Please try again.',
      });
    }),

  /**
   * Get the current status of a specific deployment.
   */
  getStatus: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const deployment = await ctx.db.deployment.findUnique({
        where: { id: input.deploymentId },
      });

      if (!deployment) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Deployment not found',
        });
      }

      // Verify the caller has access to the parent project
      await assertProjectAccess(ctx, deployment.projectId, 'VIEWER');

      return deployment;
    }),
});
