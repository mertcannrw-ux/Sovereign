import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc';
import type { Context } from '../context';

async function assertProjectAccess(
  db: Context['db'],
  projectId: string,
  userId: string,
): Promise<void> {
  const project = await db.project.findUnique({ where: { id: projectId } });

  if (!project) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
  }

  if (project.ownerId === userId) return;

  const collaborator = await db.projectCollaborator.findFirst({
    where: { projectId, userId },
  });

  if (!collaborator) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
  }
}

export const deploymentsRouter = router({
  /**
   * List all deployments for a project.
   */
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx.db, input.projectId, ctx.user.id);

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
      await assertProjectAccess(ctx.db, input.projectId, ctx.user.id);

      // Find the latest version number for this project
      const latestDeployment = await ctx.db.deployment.findFirst({
        where: { projectId: input.projectId },
        orderBy: { version: 'desc' },
      });

      const nextVersion = (latestDeployment?.version ?? 0) + 1;

      // Generate a unique subdomain slug for the deployment
      const project = await ctx.db.project.findUnique({
        where: { id: input.projectId },
      });

      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      const deploymentUrl = `https://${project.slug}-v${nextVersion}.app.example.com`;

      // Create the deployment record — in production the actual build
      // and deploy would happen asynchronously via a job queue
      const deployment = await ctx.db.deployment.create({
        data: {
          projectId: input.projectId,
          version: nextVersion,
          status: 'BUILDING',
          buildLogs: `[${new Date().toISOString()}] Starting build for version ${nextVersion}...\n`,
        },
      });

      // Simulate the build process completing
      // In production this would be handled by a background job
      const buildSteps = [
        `[${new Date().toISOString()}] Installing dependencies...`,
        `[${new Date().toISOString()}] Running build...`,
        `[${new Date().toISOString()}] Build successful`,
        `[${new Date().toISOString()}] Deploying to ${deploymentUrl}`,
        `[${new Date().toISOString()}] Deployment complete`,
      ];

      const updatedDeployment = await ctx.db.deployment.update({
        where: { id: deployment.id },
        data: {
          status: 'LIVE',
          url: deploymentUrl,
          buildLogs: deployment.buildLogs + buildSteps.join('\n') + '\n',
          deployedAt: new Date(),
        },
      });

      // Update the project's publishedAt timestamp
      await ctx.db.project.update({
        where: { id: input.projectId },
        data: { publishedAt: new Date(), status: 'PUBLISHED' },
      });

      return updatedDeployment;
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
      await assertProjectAccess(ctx.db, deployment.projectId, ctx.user.id);

      return deployment;
    }),
});
