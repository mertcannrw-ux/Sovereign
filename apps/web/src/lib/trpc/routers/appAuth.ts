import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc';

/**
 * Schema for updating auth configuration.
 */
const authConfigSchema = z.object({
  emailAuth: z.boolean().optional(),
  googleAuth: z.boolean().optional(),
  githubAuth: z.boolean().optional(),
  magicLinkAuth: z.boolean().optional(),
  sessionDuration: z.number().int().min(60).max(2592000).optional(),
  roles: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .optional(),
  permissions: z
    .array(
      z.object({
        role: z.string().min(1),
        resource: z.string().min(1),
        action: z.enum(['create', 'read', 'update', 'delete', '*']),
      }),
    )
    .optional(),
  branding: z
    .object({
      logoUrl: z.string().optional(),
      primaryColor: z.string().optional(),
      appName: z.string().optional(),
    })
    .optional(),
});

/**
 * Schema for creating an app user.
 */
const createUserSchema = z.object({
  projectId: z.string(),
  email: z.string().email(),
  name: z.string().min(1).max(100).optional(),
  password: z.string().min(6).optional(),
  role: z.string().default('user'),
});

export const appAuthRouter = router({
  /**
   * Get the auth configuration for a project.
   */
  getConfig: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.project.findUnique({
        where: { id: input.projectId },
        include: { collaborators: { where: { userId: ctx.user.id } } },
      });

      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      const isOwner = project.ownerId === ctx.user.id;
      const isCollab = project.collaborators.length > 0;
      if (!isOwner && !isCollab) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      let config = await ctx.db.appAuthConfig.findUnique({
        where: { projectId: input.projectId },
      });

      if (!config) {
        // Create default auth config for this project
        config = await ctx.db.appAuthConfig.create({
          data: { projectId: input.projectId },
        });
      }

      return config;
    }),

  /**
   * Update the auth configuration for a project.
   */
  updateConfig: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        config: authConfigSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.db.project.findUnique({
        where: { id: input.projectId },
        include: { collaborators: { where: { userId: ctx.user.id } } },
      });

      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      if (project.ownerId !== ctx.user.id) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only the project owner can update auth settings',
        });
      }

      const existing = await ctx.db.appAuthConfig.findUnique({
        where: { projectId: input.projectId },
      });

      if (!existing) {
        // Create with the provided values
        const created = await ctx.db.appAuthConfig.create({
          data: {
            projectId: input.projectId,
            emailAuth: input.config.emailAuth ?? true,
            googleAuth: input.config.googleAuth ?? false,
            githubAuth: input.config.githubAuth ?? false,
            magicLinkAuth: input.config.magicLinkAuth ?? false,
            sessionDuration: input.config.sessionDuration ?? 604800,
            roles: input.config.roles ?? [],
            permissions: input.config.permissions ?? [],
            branding: input.config.branding ?? {},
          },
        });
        return created;
      }

      const updated = await ctx.db.appAuthConfig.update({
        where: { projectId: input.projectId },
        data: {
          ...(input.config.emailAuth !== undefined && { emailAuth: input.config.emailAuth }),
          ...(input.config.googleAuth !== undefined && { googleAuth: input.config.googleAuth }),
          ...(input.config.githubAuth !== undefined && { githubAuth: input.config.githubAuth }),
          ...(input.config.magicLinkAuth !== undefined && {
            magicLinkAuth: input.config.magicLinkAuth,
          }),
          ...(input.config.sessionDuration !== undefined && {
            sessionDuration: input.config.sessionDuration,
          }),
          ...(input.config.roles !== undefined && { roles: input.config.roles }),
          ...(input.config.permissions !== undefined && { permissions: input.config.permissions }),
          ...(input.config.branding !== undefined && { branding: input.config.branding }),
        },
      });

      return updated;
    }),

  /**
   * List all users for the project's app.
   */
  listUsers: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.project.findUnique({
        where: { id: input.projectId },
        include: { collaborators: { where: { userId: ctx.user.id } } },
      });

      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      const isOwner = project.ownerId === ctx.user.id;
      const isCollab = project.collaborators.length > 0;
      if (!isOwner && !isCollab) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      const users = await ctx.db.appUser.findMany({
        where: { projectId: input.projectId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });

      return users;
    }),

  /**
   * Create a new user in the project's app (admin only — owner or admin role).
   */
  createUser: protectedProcedure.input(createUserSchema).mutation(async ({ ctx, input }) => {
    const project = await ctx.db.project.findUnique({
      where: { id: input.projectId },
      include: { collaborators: { where: { userId: ctx.user.id } } },
    });

    if (!project) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
    }

    const isOwner = project.ownerId === ctx.user.id;
    const isCollab = project.collaborators.length > 0;
    if (!isOwner && !isCollab) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
    }

    // Check for existing user with same email in this project
    const existing = await ctx.db.appUser.findUnique({
      where: { projectId_email: { projectId: input.projectId, email: input.email } },
    });

    if (existing) {
      throw new TRPCError({ code: 'CONFLICT', message: 'A user with this email already exists' });
    }

    let passwordHash: string | undefined;
    if (input.password) {
      const bcrypt = await import('bcryptjs');
      passwordHash = await bcrypt.hash(input.password, 12);
    }

    const user = await ctx.db.appUser.create({
      data: {
        projectId: input.projectId,
        email: input.email,
        name: input.name ?? null,
        passwordHash: passwordHash ?? null,
        role: input.role,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });

    return user;
  }),

  /**
   * Delete a user from the project's app (admin only).
   */
  deleteUser: protectedProcedure
    .input(z.object({ projectId: z.string(), userId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.db.project.findUnique({
        where: { id: input.projectId },
        include: { collaborators: { where: { userId: ctx.user.id } } },
      });

      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      const isOwner = project.ownerId === ctx.user.id;
      const isCollab = project.collaborators.length > 0;
      if (!isOwner && !isCollab) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      const user = await ctx.db.appUser.findUnique({
        where: { id: input.userId },
      });

      if (!user || user.projectId !== input.projectId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      await ctx.db.appUser.delete({
        where: { id: input.userId },
      });

      return { success: true };
    }),
});
