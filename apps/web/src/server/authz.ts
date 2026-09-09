import { TRPCError } from '@trpc/server';
import type { Context } from '@/lib/trpc/context';
import { OrganizationRole, ProjectRole } from '@app-builder/shared';

/** The subset of the tRPC context these checks need, so raw route handlers
 * (which have session + db but no full tRPC context) can reuse them too. */
export type AuthzContext = Pick<Context, 'user' | 'db'>;

// ─── Role hierarchy (higher index = more permissions) ─────

const ORG_ROLE_HIERARCHY: Record<OrganizationRole, number> = {
  MEMBER: 0,
  ADMIN: 1,
  OWNER: 2,
};

const PROJECT_ROLE_HIERARCHY: Record<ProjectRole, number> = {
  VIEWER: 0,
  EDITOR: 1,
  OWNER: 2,
};

function hasMinimumOrgRole(userRole: OrganizationRole, minimum: OrganizationRole): boolean {
  return ORG_ROLE_HIERARCHY[userRole] >= ORG_ROLE_HIERARCHY[minimum];
}

function hasMinimumProjectRole(userRole: ProjectRole, minimum: ProjectRole): boolean {
  return PROJECT_ROLE_HIERARCHY[userRole] >= PROJECT_ROLE_HIERARCHY[minimum];
}

// ─── Organization-level authorization ─────────────────────

export async function requireOrganizationRole(
  ctx: AuthzContext,
  organizationId: string,
  minimumRole: OrganizationRole,
): Promise<{ role: OrganizationRole }> {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  const membership = await ctx.db.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId: ctx.user.id,
      },
    },
  });

  if (!membership) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }

  if (!hasMinimumOrgRole(membership.role, minimumRole)) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }

  return { role: membership.role };
}

// ─── Project-level authorization ──────────────────────────

export async function requireProjectRole(
  ctx: AuthzContext,
  projectId: string,
  minimumRole: ProjectRole,
): Promise<{ role: ProjectRole; organizationId: string }> {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  // Check project ownership first
  const project = await ctx.db.project.findUnique({
    where: { id: projectId },
    select: { id: true, ownerId: true, organizationId: true },
  });

  if (!project) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }

  // Owner always has OWNER role
  if (project.ownerId === ctx.user.id) {
    return { role: 'OWNER' as ProjectRole, organizationId: project.organizationId };
  }

  // Check collaborator table
  const collaborator = await ctx.db.projectCollaborator.findUnique({
    where: {
      projectId_userId: {
        projectId,
        userId: ctx.user.id,
      },
    },
  });

  if (collaborator) {
    if (!hasMinimumProjectRole(collaborator.role, minimumRole)) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    return { role: collaborator.role, organizationId: project.organizationId };
  }

  // Org OWNER/ADMIN may administer every project in the organization.
  const membership = await ctx.db.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: project.organizationId,
        userId: ctx.user.id,
      },
    },
  });
  if (membership && hasMinimumOrgRole(membership.role, 'ADMIN')) {
    const mappedRole: ProjectRole = membership.role === 'OWNER' ? 'OWNER' : 'EDITOR';
    if (!hasMinimumProjectRole(mappedRole, minimumRole)) {
      throw new TRPCError({ code: 'FORBIDDEN' });
    }
    return { role: mappedRole, organizationId: project.organizationId };
  }

  throw new TRPCError({ code: 'NOT_FOUND' });
}

// ─── Convenience wrappers ─────────────────────────────────

export async function requireProjectOwner(
  ctx: AuthzContext,
  projectId: string,
): Promise<{ organizationId: string }> {
  const result = await requireProjectRole(ctx, projectId, 'OWNER');
  return { organizationId: result.organizationId };
}

export async function requireProjectEditor(
  ctx: AuthzContext,
  projectId: string,
): Promise<{ organizationId: string }> {
  const result = await requireProjectRole(ctx, projectId, 'EDITOR');
  return { organizationId: result.organizationId };
}

export async function requireProjectViewer(
  ctx: AuthzContext,
  projectId: string,
): Promise<{ organizationId: string }> {
  const result = await requireProjectRole(ctx, projectId, 'VIEWER');
  return { organizationId: result.organizationId };
}
