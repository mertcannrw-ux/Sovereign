import { seedAppTsx } from '@/lib/seed-text';
import { SEEDS } from '@app-builder/codegen';
import { Prisma, type Project } from '@prisma-generated/prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc';
import type { Context } from '../context';
import { hasRealmRole, requireProjectAccess, requireRealmRole } from '@/server/authz';
import { assertTenantSchemaName, provisionAppDatabase } from '@/server/app-database';
import { quotePgIdent } from '@/server/db-browser';
import { persistProjectFiles } from '@/lib/project-files';
import { lockRealm } from '@/server/realm-lock';
import { assertCanCreateProject } from '@/server/plans';
import { getPlanPrices } from '@/server/stripe';
import { deploySubdomain, isDeployConfigured, unpublishBundle } from '@/server/deploy/user-apps';
import { countInFlightDeployments } from '@/server/deploy/in-flight';
import { deleteAssetObjects, listProjectAssetObjectKeys } from '@/server/assets/project-assets';
import { PROJECT_SORT_GAP, moveProject } from '@/lib/project-order';

function generateSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'project'
  );
}

/** A generation run counts as in flight for this long: the generate route's 800s cap, rounded up. */
const ACTIVE_RUN_WINDOW_MS = 15 * 60 * 1000;

type ProjectRow = { id: string; updatedAt: Date; sortOrder: number };
interface ProjectListCursor {
  s: number;
  u: string;
  id: string;
}

/**
 * Decode a projects.list cursor. Returns null for absent/malformed input: a
 * cursor only ever round-trips from our own nextCursor, so a bad one means a
 * stale client - degrade to a fresh first page instead of a 500.
 */
function parseProjectListCursor(raw: string | undefined): ProjectListCursor | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.s !== 'number' || !Number.isFinite(candidate.s)) return null;
  if (typeof candidate.u !== 'string' || typeof candidate.id !== 'string') return null;
  if (Number.isNaN(Date.parse(candidate.u))) return null;
  return { s: candidate.s, u: candidate.u, id: candidate.id };
}

/**
 * Exclusive compound cursor predicate: (sortOrder, updatedAt, id) strictly
 * after the cursor in the list's (sortOrder ASC, updatedAt DESC, id DESC)
 * order. Manual sortOrder is primary; updatedAt and id keep the walk stable
 * while every project still shares the default position 0.
 */
function belowCursor(cursor: ProjectListCursor) {
  return {
    OR: [
      { sortOrder: { gt: cursor.s } },
      { sortOrder: cursor.s, updatedAt: { lt: new Date(cursor.u) } },
      { sortOrder: cursor.s, updatedAt: new Date(cursor.u), id: { lt: cursor.id } },
    ],
  };
}

/**
 * Split a (sortOrder ASC, updatedAt DESC, id DESC) page fetched with limit+1
 * rows into the page plus the compound cursor for the next page.
 */
function paginateProjects<T extends ProjectRow>(rows: T[], limit: number) {
  const hasMore = rows.length === limit + 1;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return {
    projects: page,
    nextCursor:
      hasMore && last
        ? JSON.stringify({
            s: Number(last.sortOrder),
            u: new Date(last.updatedAt).toISOString(),
            id: last.id,
          })
        : null,
  };
}

interface ProjectRecordInput {
  name: string;
  description?: string;
  modelProvider?: string;
  modelName?: string;
  realmId: string;
}

/**
 * Insert a project row with a unique slug, provision its app database, then
 * let `seed` write its initial files inside the same transaction.
 */
async function createProjectRecord(
  db: Context['db'],
  userId: string,
  input: ProjectRecordInput,
  seed: (tx: Prisma.TransactionClient, created: Project) => Promise<void>,
): Promise<Project> {
  // Slug allocation must tolerate a concurrent create of the same name:
  // check-then-create races (two creators read "free" simultaneously), and
  // a time-based suffix can collide within the same millisecond. P2002
  // from the projects_slug_key unique index is the arbiter - retry with
  // fresh entropy, like deployments.create does for its version counter.
  // The constraint name is checked so any OTHER unique violation on this
  // multi-table tx propagates instead of silently retrying 5×.
  const SLUG_MAX_ATTEMPTS = 5;
  let slug = generateSlug(input.name);
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(
        async (tx) => {
          // The pre-tx role check can race a concurrent removeMember, so
          // re-verify membership while holding the lock removeMember takes.
          await lockRealm(tx, input.realmId);
          const membership = await tx.realmMember.findUnique({
            where: { realmId_userId: { realmId: input.realmId, userId } },
          });
          if (!membership) {
            throw new TRPCError({ code: 'FORBIDDEN', message: 'Not a member of this Realm.' });
          }

          // Counted under the Realm lock, so concurrent creates cannot both
          // pass the plan's project limit.
          await assertCanCreateProject(tx, input.realmId, getPlanPrices());

          // Opportunistic dedupe inside the tx; the P2002 retry below is
          // still the arbiter under read-committed.
          const existing = await tx.project.findUnique({ where: { slug } });
          if (existing) {
            slug = `${slug}-${randomUUID().slice(0, 8)}`;
          }

          const created = await tx.project.create({
            data: {
              ownerId: userId,
              realmId: input.realmId,
              name: input.name,
              description: input.description ?? null,
              slug,
              ...(input.modelProvider !== undefined && { modelProvider: input.modelProvider }),
              ...(input.modelName !== undefined && { modelName: input.modelName }),
            },
          });
          await provisionAppDatabase(tx, created.id);
          await seed(tx, created);
          return created;
        },
        // Provisioning a tenant schema + seeding files is raw DDL + a file
        // batch; the 5s interactive default can abort legitimate creations
        // under load, so budget generously.
        { timeout: 30_000 },
      );
    } catch (error) {
      // Prisma reports the violated constraint in meta.target, as a
      // string for a column-level @unique and a list for composite
      // indexes; accept both spellings of the slug constraint.
      const target = (
        error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.target : undefined
      ) as string | string[] | undefined;
      const isSlugRace =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002' &&
        (target === 'slug' ||
          (Array.isArray(target) && target.length === 1 && target[0] === 'slug'));
      if (!isSlugRace || attempt >= SLUG_MAX_ATTEMPTS - 1) throw error;
      slug = `${generateSlug(input.name)}-${randomUUID().slice(0, 8)}`;
    }
  }
}

export const projectsRouter = router({
  /**
   * The projects of one Realm, in its manual dashboard order (newest-first
   * until the first drag). Members only.
   */
  list: protectedProcedure
    .input(
      z.object({
        realmId: z.string().uuid(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        // Server-side filter so search covers every project, not just the
        // pages the dashboard happened to load.
        search: z.string().max(100).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireRealmRole(ctx, input.realmId, 'MEMBER');
      // A Realm's project count is unbounded, so the query is paged. Cursor =
      // JSON {s, u, id} of the last item of the previous page, per
      // paginateProjects below.
      const cursor = parseProjectListCursor(input.cursor);
      const take = input.limit + 1;
      const search = input.search?.trim().toLowerCase();
      const projects = await ctx.db.project.findMany({
        where: {
          AND: [
            { realmId: input.realmId },
            ...(cursor ? [belowCursor(cursor)] : []),
            ...(search
              ? [
                  {
                    OR: [
                      { name: { contains: search, mode: 'insensitive' as const } },
                      { description: { contains: search, mode: 'insensitive' as const } },
                    ],
                  },
                ]
              : []),
          ],
        },
        orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }, { id: 'desc' }],
        take,
        include: {
          owner: {
            select: { id: true, name: true, email: true },
          },
          // Latest live deployment, for the dashboard card's site link.
          deployments: {
            where: { status: 'LIVE' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { url: true, customDomain: true },
          },
          // Zero files means the project was never built: the dashboard
          // shows an empty card instead of a preview.
          _count: { select: { files: true } },
          // An in-flight build, for the card's generating mark. Runs older
          // than the generate route's maxDuration (800s) were killed without
          // settling their status, so they don't count.
          generationRuns: {
            where: {
              status: { in: ['RUNNING', 'WAITING_RUNTIME', 'VERIFYING'] },
              startedAt: { gte: new Date(Date.now() - ACTIVE_RUN_WINDOW_MS) },
            },
            take: 1,
            select: { id: true },
          },
        },
      });
      return paginateProjects(projects, input.limit);
    }),

  /**
   * Move one project between two neighbours in the Realm's dashboard order.
   * Any member may rearrange the shared list. The read-compute-write runs
   * under the Realm's advisory lock so concurrent drags cannot interleave.
   * Positions are written with raw SQL so a card's `updatedAt` (its
   * "Edited ..." label) stays untouched.
   */
  reorder: protectedProcedure
    .input(
      z.object({
        realmId: z.string().uuid(),
        id: z.string(),
        previousId: z.string().nullable(),
        nextId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireRealmRole(ctx, input.realmId, 'MEMBER');
      if (input.previousId === input.id || input.nextId === input.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A project cannot be its own neighbour.',
        });
      }

      // Serialized like create/delete: under read-committed, two simultaneous
      // drags compute from the same snapshot — both can land on the same
      // fractional position (the updatedAt tiebreak silently picks a winner)
      // and the rewrite-everything path would revert an interleaved
      // single-row move.
      return ctx.db.$transaction(async (tx) => {
        await lockRealm(tx, input.realmId);

        const ordered = await tx.project.findMany({
          where: { realmId: input.realmId },
          select: { id: true, sortOrder: true, updatedAt: true },
          orderBy: [{ sortOrder: 'asc' }, { updatedAt: 'desc' }, { id: 'desc' }],
        });
        if (!ordered.some((project) => project.id === input.id)) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
        }

        const { order, position } = moveProject(ordered, input.id, input.previousId, input.nextId);

        if (position === null) {
          // The neighbours have no float gap left: rewrite the whole order
          // with even spacing in one statement, leaving updatedAt untouched.
          const values = order.map(
            (project, index) =>
              Prisma.sql`(${project.id}, ${(index + 1) * PROJECT_SORT_GAP}::double precision)`,
          );
          await tx.$executeRaw`
            UPDATE "projects" AS p
            SET "sort_order" = v.position
            FROM (VALUES ${Prisma.join(values)}) AS v(id, position)
            WHERE p."id" = v.id AND p."realm_id" = ${input.realmId}
          `;
          return { success: true as const };
        }

        await tx.$executeRaw`UPDATE "projects" SET "sort_order" = ${position} WHERE "id" = ${input.id} AND "realm_id" = ${input.realmId}`;
        return { success: true as const };
      });
    }),

  /**
   * Create a new project.  Assigns the current user as owner and
   * auto-generates a unique slug.
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100).default('Untitled Project'),
        description: z.string().max(500).optional(),
        modelProvider: z.string().optional(),
        modelName: z.string().optional(),
        realmId: z.string().uuid(),
        templateId: z.string().max(80).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireRealmRole(ctx, input.realmId, 'MEMBER');

      return createProjectRecord(ctx.db, ctx.user.id, input, async (tx, created) => {
        if (!input.templateId) return;
        await persistProjectFiles(
          tx,
          created.id,
          Object.entries(SEEDS).map(([path, content]) => ({
            path,
            content:
              path === 'src/App.tsx' ? seedAppTsx(input.name, input.description ?? '') : content,
          })),
        );
      });
    }),

  /**
   * Copy a project's metadata and files into a new draft in the same Realm. Chat history, deployments and app data are not copied.
   */
  duplicate: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.id);
      const source = await ctx.db.project.findUnique({
        where: { id: input.id },
        include: { files: { select: { path: true, content: true } } },
      });
      if (!source) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });

      return createProjectRecord(
        ctx.db,
        ctx.user.id,
        {
          name: `${source.name} copy`.slice(0, 100),
          description: source.description ?? undefined,
          modelProvider: source.modelProvider,
          modelName: source.modelName,
          realmId: source.realmId,
        },
        (tx, created) => persistProjectFiles(tx, created.id, source.files),
      );
    }),

  /**
   * One project with its Realm. Members of the project's Realm only.
   */
  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const { role } = await requireProjectAccess(ctx, input.id);
    const project = await ctx.db.project.findUniqueOrThrow({
      where: { id: input.id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        realm: { select: { id: true, name: true, type: true } },
      },
    });
    return { ...project, role };
  }),

  /** Return the latest persisted project filesystem for live preview. */
  files: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.id);
    const files = await ctx.db.projectFile.findMany({
      where: { projectId: input.id },
      orderBy: { path: 'asc' },
      select: { path: true, content: true },
    });
    return files;
  }),

  /**
   * Update project metadata. Any member of the project's Realm.
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(500).optional(),
        modelProvider: z.string().optional(),
        modelName: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.id);

      const updated = await ctx.db.project.update({
        where: { id: input.id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.description !== undefined && {
            description: input.description,
          }),
          ...(input.modelProvider !== undefined && {
            modelProvider: input.modelProvider,
          }),
          ...(input.modelName !== undefined && {
            modelName: input.modelName,
          }),
        },
      });

      return updated;
    }),

  /**
   * Delete a project. Owner/Admin, or the member who created it.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { role, ownerId } = await requireProjectAccess(ctx, input.id);
      if (!hasRealmRole(role, 'ADMIN') && ownerId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only an owner or admin can delete a project someone else created.',
        });
      }
      await deleteProject(ctx.db, input.id);
      return { success: true as const };
    }),
});

function deployRunningError(): TRPCError {
  return new TRPCError({
    code: 'CONFLICT',
    message: 'A deploy is running for this project. Wait for it to finish, then delete it.',
  });
}

/**
 * Delete a project and its app database. The caller has already authorized it.
 */
export async function deleteProject(db: Context['db'], projectId: string): Promise<void> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, slug: true, status: true, publishedAt: true, realmId: true },
  });
  const appDb = await db.appDatabase.findFirst({ where: { projectId } });
  const schemaName = appDb ? assertTenantSchemaName(appDb.schemaName) : null;

  // Deploys take the same lock. A deploy still uploading would finish after
  // this delete, so refuse up front rather than take the app offline first.
  if (project) {
    await db.$transaction(async (tx) => {
      await lockRealm(tx, project.realmId);
      if ((await countInFlightDeployments(tx, projectId)) > 0) throw deployRunningError();
    });
  }

  // Take the live app down first: the deployment row cascades with the project
  // and is the only handle that can address its R2 prefix, so deleting the row
  // while the bundle is published leaves an app nobody can un-publish.
  if (project?.status === 'PUBLISHED' && isDeployConfigured()) {
    try {
      await unpublishBundle(deploySubdomain(project));
    } catch (error) {
      console.error('[projects] failed to unpublish app before delete', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: "We couldn't take the live app offline. Nothing was deleted. Try again.",
      });
    }
  }

  // Asset rows cascade with the project but the stored objects do not. Read the
  // keys first and delete the objects only after the row delete commits: a
  // failed transaction must not destroy the assets of a project that still
  // exists.
  const assetKeys = await listProjectAssetObjectKeys([projectId]);

  await db.$transaction(async (tx) => {
    if (project) {
      // Re-check under the lock: a deploy that started or finished since the
      // status was read would otherwise leave a live bundle with no row left
      // to unpublish it from. Every deploy that starts after this commits
      // finds the row gone and removes its own upload.
      await lockRealm(tx, project.realmId);
      if ((await countInFlightDeployments(tx, projectId)) > 0) throw deployRunningError();
      const current = await tx.project.findUnique({
        where: { id: projectId },
        select: { status: true, publishedAt: true },
      });
      if (
        current &&
        (current.status !== project.status ||
          current.publishedAt?.getTime() !== project.publishedAt?.getTime())
      ) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'The project was published while it was being deleted. Try again.',
        });
      }
    }
    // The tenant schema holds the end users' data; deleting the project row
    // alone (which cascades the AppDatabase row) would orphan it on the
    // cluster forever. Drop it in the same transaction, before the row.
    if (schemaName) {
      await tx.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quotePgIdent(schemaName)} CASCADE`);
    }
    await tx.project.delete({ where: { id: projectId } });
  });

  await deleteAssetObjects(assetKeys);
}
