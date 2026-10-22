import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc';
import type { Context } from '../context';
import { env } from '@/env';
import { requireProjectAccess } from '@/server/authz';
import { checkRateLimit } from '@/server/rate-limit';
import {
  DeployRejectedError,
  MAX_DEPLOYS_PER_DAY,
  MAX_FILES,
  MAX_LIVE_APPS,
  MAX_LIVE_APPS_PER_USER,
  deployDomainSharesSite,
  deploySubdomain,
  deployUrl,
  isDeployConfigured,
  publishBundle,
  unpublishBundle,
  validateBundle,
} from '@/server/deploy/user-apps';
import { Prisma } from '@prisma-generated/prisma/client';
import { lockRealm } from '@/server/realm-lock';

function assertDeployConfigured(): void {
  if (!isDeployConfigured()) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'App hosting is not configured (DEPLOY_DOMAIN, DEPLOY_R2_BUCKET and R2_* keys).',
    });
  }
}

/**
 * Refuse to publish untrusted apps onto this app's own site. Unpublish stays
 * allowed so existing apps can still be taken down.
 */
function assertDeployDomainIsolated(): void {
  if (deployDomainSharesSite([env.NEXTAUTH_URL, env.NEXT_PUBLIC_APP_URL])) {
    console.error('[deploy] DEPLOY_DOMAIN shares a site with the app; refusing to publish');
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'App hosting is misconfigured. Please contact support.',
    });
  }
}

async function loadProject(ctx: Context, projectId: string) {
  const project = await ctx.db.project.findUnique({ where: { id: projectId } });
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
  return project;
}

/**
 * Per-Realm share of `MAX_DEPLOYS_PER_DAY`. That constant is the platform-wide
 * budget the R2 free tier was sized against (see server/deploy/user-apps.ts), so
 * one tenant must not be allowed to spend all of it: ten Realms at their own cap
 * reach the platform cap, one does not.
 */
const MAX_DEPLOYS_PER_REALM_PER_DAY = 20;

/**
 * Refuse a deploy that would push R2 past its free tier. Checked before any
 * write; see the budget in src/server/deploy/user-apps.ts.
 */
async function assertWithinCaps(
  ctx: Context,
  project: { id: string; ownerId: string; realmId: string },
) {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const otherLive = { publishedAt: { not: null }, id: { not: project.id } } as const;
  const [deploysToday, realmDeploysToday, liveApps, ownerLiveApps] = await Promise.all([
    // Platform-wide: the per-Realm cap scales with the number of Realms users
    // create, so on its own it cannot keep R2 writes inside the free tier.
    ctx.db.deployment.count({ where: { createdAt: { gte: dayAgo } } }),
    // Per Realm, so one tenant deploying at its permitted rate cannot exhaust
    // the shared budget for everybody.
    ctx.db.deployment.count({
      where: { createdAt: { gte: dayAgo }, project: { realmId: project.realmId } },
    }),
    ctx.db.project.count({ where: otherLive }),
    ctx.db.project.count({ where: { ...otherLive, ownerId: project.ownerId } }),
  ]);
  if (deploysToday >= MAX_DEPLOYS_PER_DAY) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Deploys are paused today. Please try again tomorrow.',
    });
  }
  if (realmDeploysToday >= MAX_DEPLOYS_PER_REALM_PER_DAY) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Deploys are paused for this Realm today. Please try again tomorrow.',
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
      await requireProjectAccess(ctx, input.projectId);

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
        files: z
          .array(
            z.object({
              path: z.string().max(300),
              // ~8 MB of base64 per file, matching the bundle budget; the total
              // is enforced by validateBundle after decode.
              data: z.string().max(11_000_000),
            }),
          )
          .max(MAX_FILES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      assertDeployConfigured();
      assertDeployDomainIsolated();

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

      // Defense in depth: never publish over another project's live app, even
      // if two projects ever map to the same subdomain.
      const owner = await ctx.db.deployment.findFirst({
        where: { url, status: 'LIVE', projectId: { not: project.id } },
        select: { id: true },
      });
      if (owner) {
        console.error(`[deploy] ${url} is live for another project; refusing ${project.id}`);
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This app address is already in use. Please contact support.',
        });
      }

      // Retry loop for concurrent P2002 version race
      let deployment;
      for (let attempt = 1; !deployment; attempt++) {
        try {
          deployment = await ctx.db.$transaction(async (tx) => {
            // One publish per project at a time: `publishBundle` prunes every
            // key its own file set does not contain, so two overlapping
            // publishes delete each other's chunks and leave the live app
            // referencing missing assets.
            await lockRealm(tx, project.realmId);
            const inFlight = await tx.deployment.count({
              where: {
                projectId: project.id,
                status: 'DEPLOYING',
                createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
              },
            });
            if (inFlight > 0) {
              throw new TRPCError({
                code: 'CONFLICT',
                message: 'A deploy for this project is already running. Wait for it to finish.',
              });
            }
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
      const live = await ctx.db.$transaction(async (tx) => {
        // Unpublish takes the same lock. Re-read the row under it: an unpublish
        // that landed while the bundle was uploading must not be overwritten by
        // this deploy marking the project PUBLISHED again.
        await lockRealm(tx, project.realmId);
        const current = await tx.deployment.findUnique({
          where: { id: deployment.id },
          select: { status: true },
        });
        if (current?.status !== 'DEPLOYING') return null;

        const updated = await tx.deployment.update({
          where: { id: deployment.id },
          data: {
            status: 'LIVE',
            deployedAt: now,
            buildLogs: `[${now.toISOString()}] Published ${files.length} files to ${url}\n`,
          },
        });
        await tx.project.update({
          where: { id: project.id },
          data: { status: 'PUBLISHED', publishedAt: now },
        });
        return updated;
      });

      if (!live) {
        // Another request unpublished (or deleted) the project mid-deploy.
        // Remove whatever this publish wrote after that listing so the app does
        // not come back online, then report the conflict truthfully.
        await unpublishBundle(subdomain).catch((error) => {
          console.error('[deploy] failed to clean up a canceled deployment bundle', error);
        });
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            'The project was unpublished while this deploy was running. Deploy again to publish it.',
        });
      }
      return live;
    }),

  /**
   * Take the project's app offline and free its live-app slot.
   */
  unpublish: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      assertDeployConfigured();

      // Each unpublish lists and deletes the whole R2 prefix, so it is metered
      // like a deploy rather than left as an unauthenticated-cost lever.
      const rate = await checkRateLimit('deploy', ctx.user.id);
      if (!rate.allowed) {
        const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Deployment rate limit exceeded. Try again in ${retryIn}s.`,
        });
      }

      const project = await loadProject(ctx, input.projectId);

      // The deploy path takes this same lock and leaves a DEPLOYING row while
      // its bundle uploads. Refuse to unpublish over it: taking the app offline
      // mid-upload let the deploy finish afterwards and put it back online.
      const liveDeploymentIds = await ctx.db.$transaction(async (tx) => {
        await lockRealm(tx, project.realmId);
        const inFlight = await tx.deployment.count({
          where: {
            projectId: project.id,
            status: 'DEPLOYING',
            createdAt: { gte: new Date(Date.now() - 10 * 60 * 1000) },
          },
        });
        if (inFlight > 0) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'A deploy is running for this project. Wait for it to finish, then unpublish.',
          });
        }

        const live = await tx.deployment.findMany({
          where: { projectId: project.id, status: 'LIVE' },
          select: { id: true },
        });
        await tx.deployment.updateMany({
          where: { projectId: project.id, status: 'LIVE' },
          data: { status: 'CANCELED' },
        });
        await tx.project.update({
          where: { id: project.id },
          data: { status: 'DRAFT', publishedAt: null },
        });
        return live.map((row) => row.id);
      });

      try {
        await unpublishBundle(deploySubdomain(project));
      } catch (error) {
        // The bundle is still live, so put the recorded state back rather than
        // leaving the project marked DRAFT with a reachable app.
        await ctx.db
          .$transaction([
            ctx.db.deployment.updateMany({
              where: { id: { in: liveDeploymentIds } },
              data: { status: 'LIVE' },
            }),
            ctx.db.project.update({
              where: { id: project.id },
              data: { status: project.status, publishedAt: project.publishedAt },
            }),
          ])
          .catch((rollbackError) => {
            console.error(
              '[deploy] failed to restore state after unpublish failure',
              rollbackError,
            );
          });
        console.error('[deploy] unpublish failed', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Could not take the app offline. Try again.',
        });
      }
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
      await requireProjectAccess(ctx, deployment.projectId);

      return deployment;
    }),
});
