import { SEEDS } from '@app-builder/codegen';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc';
import { requireOrganizationRole, requireProjectRole } from '@/server/authz';
import { assertTenantSchemaName, provisionAppDatabase } from '@/server/app-database';
import { quotePgIdent } from '@/server/db-browser';
import { persistProjectFiles } from '@/lib/project-files';

function generateSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'project'
  );
}

export const projectsRouter = router({
  /**
   * List all projects the current user owns or collaborates on.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const projects = await ctx.db.project.findMany({
      where: {
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
      orderBy: { updatedAt: 'desc' },
      include: {
        owner: {
          select: { id: true, name: true, email: true },
        },
      },
    });
    return projects;
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

      let slug = generateSlug(input.name);

      // Ensure the slug is unique
      const existing = await ctx.db.project.findUnique({ where: { slug } });
      if (existing) {
        slug = `${slug}-${Date.now().toString(36)}`;
      }

      const project = await ctx.db.$transaction(async (tx) => {
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
      });

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
