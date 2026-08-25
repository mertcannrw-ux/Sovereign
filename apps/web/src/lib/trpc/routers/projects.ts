import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc';
import { requireOrganizationRole, requireProjectRole } from '@/server/authz';

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
        OR: [{ ownerId: ctx.user.id }, { collaborators: { some: { userId: ctx.user.id } } }],
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

      const project = await ctx.db.project.create({
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

      await ctx.db.project.delete({ where: { id: input.id } });

      return { success: true as const };
    }),
});
