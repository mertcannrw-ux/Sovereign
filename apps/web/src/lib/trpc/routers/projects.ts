import { SEEDS } from '@app-builder/codegen';
import { Prisma, type Project } from '@prisma-generated/prisma/client';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc';
import { requireOrganizationRole, requireProjectRole } from '@/server/authz';
import { assertTenantSchemaName, provisionAppDatabase } from '@/server/app-database';
import { quotePgIdent } from '@/server/db-browser';
import { persistProjectFiles } from '@/lib/project-files';
import { lockOrganizationMembership } from '@/server/org-lock';

function generateSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'project'
  );
}

type ProjectRow = { id: string; updatedAt: Date };
interface ProjectListCursor {
  u: string;
  id: string;
}

/**
 * Decode a projects.list cursor. Returns null for absent/malformed input: a
 * cursor only ever round-trips from our own nextCursor, so a bad one means a
 * stale client — degrade to a fresh first page instead of a 500.
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
  if (typeof candidate.u !== 'string' || typeof candidate.id !== 'string') return null;
  if (Number.isNaN(Date.parse(candidate.u))) return null;
  return { u: candidate.u, id: candidate.id };
}

/**
 * Exclusive compound cursor predicate: (updatedAt, id) strictly below the
 * cursor in the query's (updatedAt DESC, id DESC) sort order. The id
 * tiebreaker keeps the walk stable when rows share updatedAt (bulk-created
 * projects) and prevents pagination skips.
 */
function belowCursor(cursor: ProjectListCursor) {
  return {
    OR: [
      { updatedAt: { lt: new Date(cursor.u) } },
      { updatedAt: new Date(cursor.u), id: { lt: cursor.id } },
    ],
  };
}

/**
 * Split a (updatedAt DESC, id DESC) page fetched with limit+1 rows into the
 * page plus the compound cursor for the next older page.
 */
function paginateProjects<T extends ProjectRow>(rows: T[], limit: number) {
  const hasMore = rows.length === limit + 1;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return {
    projects: page,
    nextCursor:
      hasMore && last
        ? JSON.stringify({ u: new Date(last.updatedAt).toISOString(), id: last.id })
        : null,
  };
}

export const projectsRouter = router({
  /**
   * List all projects the current user owns or collaborates on.
   */
  list: protectedProcedure
    .input(
      z
        .object({
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(100).default(50),
          // Server-side filter so search covers every project, not just the
          // pages the dashboard happened to load.
          search: z.string().max(100).optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      // Org admins see every project of every org they administer, so this
      // query is unbounded without a cap. Cursor = JSON {u, id} of the last
      // item of the previous page, per paginateProjects below.
      const cursor = parseProjectListCursor(input.cursor);
      const take = input.limit + 1;
      const search = input.search?.trim().toLowerCase();
      const projects = await ctx.db.project.findMany({
        where: {
          AND: [
            {
              OR: [
                { ownerId: ctx.user.id },
                { collaborators: { some: { userId: ctx.user.id } } },
                {
                  organization: {
                    members: {
                      some: { userId: ctx.user.id, role: { in: ['OWNER', 'ADMIN'] } },
                    },
                  },
                },
              ],
            },
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
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take,
        include: {
          owner: {
            select: { id: true, name: true, email: true },
          },
        },
      });
      return paginateProjects(projects, input.limit);
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
        organizationId: z.string().uuid(),
        templateId: z.string().max(80).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrganizationRole(ctx, input.organizationId, 'MEMBER');

      // Slug allocation must tolerate a concurrent create of the same name:
      // check-then-create races (two creators read "free" simultaneously), and
      // a time-based suffix can collide within the same millisecond. P2002
      // from the projects_slug_key unique index is the arbiter — retry with
      // fresh entropy, like deployments.create does for its version counter.
      // The constraint name is checked so any OTHER unique violation on this
      // multi-table tx propagates instead of silently retrying 5×.
      const SLUG_MAX_ATTEMPTS = 5;
      let slug = generateSlug(input.name);
      let project: Project | null = null;
      for (let attempt = 0; ; attempt += 1) {
        try {
          project = await ctx.db.$transaction(
            async (tx) => {
              // Serialize against removeMember offboarding for this org: the
              // pre-tx role check can race a concurrent removal, so re-verify
              // membership while holding the same advisory lock removeMember
              // uses. Otherwise the removed user could create (and own, via the
              // ownerId-grants-OWNER shortcut in requireProjectRole) a project
              // in an organization they were just removed from.
              await lockOrganizationMembership(tx, input.organizationId);
              const membership = await tx.organizationMember.findUnique({
                where: {
                  organizationId_userId: {
                    organizationId: input.organizationId,
                    userId: ctx.user.id,
                  },
                },
              });
              if (!membership) {
                throw new TRPCError({
                  code: 'FORBIDDEN',
                  message: 'Not a member of this organization.',
                });
              }

              // Opportunistic dedupe inside the tx; the P2002 retry below is
              // still the arbiter under read-committed.
              const existing = await tx.project.findUnique({ where: { slug } });
              if (existing) {
                slug = `${slug}-${randomUUID().slice(0, 8)}`;
              }

              const created = await tx.project.create({
                data: {
                  ownerId: ctx.user.id,
                  organizationId: input.organizationId,
                  name: input.name,
                  description: input.description ?? null,
                  slug,
                  ...(input.modelProvider !== undefined && { modelProvider: input.modelProvider }),
                  ...(input.modelName !== undefined && { modelName: input.modelName }),
                },
              });
              await provisionAppDatabase(tx, created.id);
              if (input.templateId) {
                const safeName = input.name.replace(/[<>&`]/g, '');
                const safeDescription = (input.description ?? '').replace(/[<>&`]/g, '');
                await persistProjectFiles(
                  tx,
                  created.id,
                  Object.entries(SEEDS).map(([path, content]) => ({
                    path,
                    content:
                      path === 'src/App.tsx'
                        ? `export default function App() {\n  return (\n    <main>\n      <h1>${safeName}</h1>\n      <p>${safeDescription}</p>\n    </main>\n  );\n}\n`
                        : content,
                  })),
                );
              }
              return created;
            },
            // Provisioning a tenant schema + seeding template files is raw DDL
            // + a file batch; the 5s interactive default can abort legitimate
            // creations under load, so budget generously.
            { timeout: 30_000 },
          );
          break;
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

      return project;
    }),

  /**
   * Get a project by id.  Only the owner or a collaborator may access it.
   */
  getById: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const project = await ctx.db.project.findUnique({
      where: { id: input.id },
      include: {
        owner: {
          select: { id: true, name: true, email: true },
        },
        collaborators: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });

    if (!project) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Project not found',
      });
    }

    await requireProjectRole(ctx, input.id, 'VIEWER');

    return project;
  }),

  /** Return the latest persisted project filesystem for live preview. */
  files: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const project = await ctx.db.project.findUnique({
      where: { id: input.id },
      include: { files: { orderBy: { path: 'asc' } } },
    });
    if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });

    await requireProjectRole(ctx, input.id, 'VIEWER');

    return project.files.map((file) => ({ path: file.path, content: file.content }));
  }),

  /**
   * Update project metadata.  Only the owner may update.
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
      await requireProjectRole(ctx, input.id, 'OWNER');

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
   * Delete a project.  Only the owner may delete.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectRole(ctx, input.id, 'OWNER');

      const appDb = await ctx.db.appDatabase.findFirst({ where: { projectId: input.id } });
      const schemaName = appDb ? assertTenantSchemaName(appDb.schemaName) : null;

      await ctx.db.$transaction(async (tx) => {
        // The tenant schema holds the end users' data; deleting the project row
        // alone (which cascades the AppDatabase row) would orphan it on the
        // cluster forever. Drop it in the same transaction, before the row.
        if (schemaName) {
          await tx.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quotePgIdent(schemaName)} CASCADE`);
        }
        await tx.project.delete({ where: { id: input.id } });
      });

      return { success: true as const };
    }),
});
