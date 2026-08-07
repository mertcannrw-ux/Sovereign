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

function defaultHandlerCode(): string {
  return [
    '// Handler for your API endpoint',
    'export async function handler(req: Request): Promise<Response> {',
    '  return new Response(',
    '    JSON.stringify({ message: "Hello from your function!" }),',
    '    { headers: { "Content-Type": "application/json" } },',
    '  );',
    '}',
  ].join('\n');
}

export const functionsRouter = router({
  /**
   * List all backend functions for a project.
   */
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertProjectAccess(ctx.db, input.projectId, ctx.user.id);

      const functions = await ctx.db.backendFunction.findMany({
        where: { projectId: input.projectId },
        orderBy: { createdAt: 'desc' },
      });

      return functions;
    }),

  /**
   * Create a new backend function for a project.
   */
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        path: z.string().min(1, 'Path is required').startsWith('/'),
        method: z.string().default('GET'),
        code: z.string().default(defaultHandlerCode()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertProjectAccess(ctx.db, input.projectId, ctx.user.id);

      // Check for duplicates
      const existing = await ctx.db.backendFunction.findUnique({
        where: {
          projectId_path_method: {
            projectId: input.projectId,
            path: input.path,
            method: input.method,
          },
        },
      });

      if (existing) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `A function already exists at ${input.method} ${input.path}`,
        });
      }

      const func = await ctx.db.backendFunction.create({
        data: {
          projectId: input.projectId,
          path: input.path,
          method: input.method,
          code: input.code,
          enabled: true,
        },
      });

      return func;
    }),

  /**
   * Update an existing backend function's code or metadata.
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        path: z.string().min(1).startsWith('/').optional(),
        method: z.string().optional(),
        code: z.string().optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.backendFunction.findUnique({
        where: { id: input.id },
      });

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Function not found',
        });
      }

      await assertProjectAccess(ctx.db, existing.projectId, ctx.user.id);

      const updated = await ctx.db.backendFunction.update({
        where: { id: input.id },
        data: {
          ...(input.path !== undefined && { path: input.path }),
          ...(input.method !== undefined && { method: input.method }),
          ...(input.code !== undefined && { code: input.code }),
          ...(input.enabled !== undefined && { enabled: input.enabled }),
        },
      });

      return updated;
    }),

  /**
   * Delete a backend function.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.backendFunction.findUnique({
        where: { id: input.id },
      });

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Function not found',
        });
      }

      await assertProjectAccess(ctx.db, existing.projectId, ctx.user.id);

      await ctx.db.backendFunction.delete({ where: { id: input.id } });

      return { success: true as const };
    }),
});
