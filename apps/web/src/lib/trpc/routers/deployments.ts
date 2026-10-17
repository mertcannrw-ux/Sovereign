import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc';
import type { Context } from '../context';
import type { ProjectRole } from '@app-builder/shared';
import { requireProjectRole } from '@/server/authz';
import { checkRateLimit } from '@/server/rate-limit';
import {
  DeployRejectedError,
  MAX_DEPLOYS_PER_DAY,
  MAX_FILES,
  MAX_LIVE_APPS,
  MAX_LIVE_APPS_PER_USER,
  deploySubdomain,
  deployUrl,
  isDeployConfigured,
  publishBundle,
  unpublishBundle,
  validateBundle,
} from '@/server/deploy/user-apps';
import { Prisma } from '@prisma-generated/prisma/client';

async function assertProjectAccess(
  ctx: Context,
  projectId: string,
  minimumRole: ProjectRole = 'VIEWER',
): Promise<void> {
  await requireProjectRole(ctx, projectId, minimumRole);
}

function assertDeployConfigured(): void {
  if (!isDeployConfigured()) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'App hosting is not configured (DEPLOY_DOMAIN, DEPLOY_R2_BUCKET and R2_* keys).',
    });
  }
}

async function loadProject(ctx: Context, projectId: string) {
  const project = await ctx.db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
  return project;
}

/**
 * Refuse a deploy that would push R2 past its free tier. Checked before any
 * write; see the budget in src/server/deploy/user-apps.ts.
 */
async function assertWithinCaps(ctx: Context, project: { id: string; ownerId: string }) {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const otherLive = { publishedAt: { not: null }, id: { not: project.id } } as const;
  const [deploysToday, liveApps, ownerLiveApps] = await Promise.all([
    ctx.db.deployment.count({ where: { createdAt: { gte: dayAgo } } }),
    ctx.db.project.count({ where: otherLive }),
    ctx.db.project.count({ where: { ...otherLive, ownerId: project.ownerId } }),
  ]);
  if (deploysToday >= MAX_DEPLOYS_PER_DAY) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Deploys are paused for today. Please try again tomorrow.',
    });
  }
  if (ownerLiveApps >= MAX_LIVE_APPS_PER_USER) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `You can have ${MAX_LIVE_APPS_PER_USER} live apps. Unpublish one to deploy this one.`,
    });
  }
  if (liveApps >= MAX_LIVE_APPS) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'App hosting is full right now. Please try again later.',
    });
  }
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
   * Publish a build the browser produced (see `buildForDeploy`) to
   * `https://<subdomain>.<DEPLOY_DOMAIN>`, replacing the live version.
   */
  deploy: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        files: z.array(z.object({ path: z.string().max(300), data: z.string() })).max(MAX_FILES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId, 'EDITOR');
      assertDeployConfigured();

      const rate = await checkRateLimit('deploy', ctx.user.id);
      if (!rate.allowed) {
        const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Deployment rate limit exceeded. Try again in ${retryIn}s.`,
        });
      }

      let files;
      try {
        files = validateBundle(input.files);
      } catch (error) {
        if (error instanceof DeployRejectedError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: error.message });
        }
        throw error;
      }

      const project = await loadProject(ctx, input.projectId);
      await assertWithinCaps(ctx, project);

      const subdomain = deploySubdomain(project);
      const url = deployUrl(subdomain);

      // Retry loop for concurrent P2002 version race
      let deployment;
      for (let attempt = 1; !deployment; attempt++) {
        try {
          deployment = await ctx.db.$transaction(async (tx) => {
            const latest = await tx.deployment.findFirst({
              where: { projectId: project.id },
              orderBy: { version: 'desc' },
            });
            return tx.deployment.create({
              data: {
                projectId: project.id,
                version: (latest?.version ?? 0) + 1,
                status: 'DEPLOYING',
                url,
              },
            });
          });
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2002' &&
            attempt < 3
          ) {
            continue;
          }
          throw err;
        }
      }

      try {
        await publishBundle(subdomain, files);
      } catch (error) {
        console.error('[deploy] publish failed', error);
        await ctx.db.deployment.update({
          where: { id: deployment.id },
          data: { status: 'FAILED', buildLogs: 'Upload to hosting failed.\n' },
        });
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Upload to hosting failed. Please try again.',
        });
      }

      const now = new Date();
      const [live] = await ctx.db.$transaction([
        ctx.db.deployment.update({
          where: { id: deployment.id },
          data: {
            status: 'LIVE',
            deployedAt: now,
            buildLogs: `[${now.toISOString()}] Published ${files.length} files to ${url}\n`,
          },
        }),
        ctx.db.project.update({
          where: { id: project.id },
          data: { status: 'PUBLISHED', publishedAt: now },
        }),
      ]);
      return live;
    }),

  /**
   * Take the project's app offline and free its live-app slot.
   */
  unpublish: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx, input.projectId, 'EDITOR');
      assertDeployConfigured();

      const project = await loadProject(ctx, input.projectId);
      await unpublishBundle(deploySubdomain(project));
      await ctx.db.$transaction([
        ctx.db.deployment.updateMany({
          where: { projectId: project.id, status: 'LIVE' },
          data: { status: 'CANCELED' },
        }),
        ctx.db.project.update({
          where: { id: project.id },
          data: { status: 'DRAFT', publishedAt: null },
        }),
      ]);
      return { ok: true as const };
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
