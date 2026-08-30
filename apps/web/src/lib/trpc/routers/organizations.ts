import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma-generated/prisma/client';
import { protectedProcedure, router } from '../trpc';
import { requireOrganizationRole } from '@/server/authz';
import { OrganizationRole } from '@app-builder/shared';

// ─── Helpers ──────────────────────────────────────────────

function generateSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80) || 'organization'
  );
}

function generateInviteToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

async function createAuditEvent(
  db: PrismaClient,
  actorId: string,
  ipHash: string,
  organizationId: string,
  action: string,
  targetType: string,
  targetId?: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await db.auditEvent.create({
    data: {
      organizationId,
      actorId,
      action,
      targetType,
      targetId: targetId ?? null,
      metadata: (metadata ?? undefined) as any,
      ipHash,
    },
  });
}

// ─── Router ───────────────────────────────────────────────

export const organizationsRouter = router({
  /**
   * List all organizations the current user is a member of.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.db.organizationMember.findMany({
      where: { userId: ctx.user.id },
      include: {
        organization: {
          include: {
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { organization: { updatedAt: 'desc' } },
    });

    return memberships.map((m) => ({
      ...m.organization,
      role: m.role,
    }));
  }),

  /**
   * Create a new organization.
   * The creating user is automatically added as the owner.
   */
  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      let slug = generateSlug(input.name);

      // Ensure unique slug
      const existing = await ctx.db.organization.findUnique({ where: { slug } });
      if (existing) {
        slug = `${slug}-${Date.now().toString(36)}`;
      }

      const org = await ctx.db.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: { name: input.name, slug, ownerId: ctx.user.id },
        });

        await tx.organizationMember.create({
          data: {
            organizationId: organization.id,
            userId: ctx.user.id,
            role: 'OWNER',
          },
        });

        await tx.auditEvent.create({
          data: {
            organizationId: organization.id,
            actorId: ctx.user.id,
            action: 'organization.created',
            targetType: 'organization',
            targetId: organization.id,
            ipHash: ctx.ipHash,
          },
        });

        return organization;
      });

      return org;
    }),

  /**
   * Get an organization by ID.
   * Requires membership (at least MEMBER role).
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { role } = await requireOrganizationRole(ctx, input.id, 'MEMBER');

      const organization = await ctx.db.organization.findUnique({
        where: { id: input.id },
        include: { _count: { select: { members: true } } },
      });

      if (!organization) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      return { ...organization, role };
    }),

  /**
   * Update organization metadata.
   * Requires ADMIN or OWNER role.
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrganizationRole(ctx, input.id, 'ADMIN');

      const organization = await ctx.db.organization.update({
        where: { id: input.id },
        data: { name: input.name },
      });

      await createAuditEvent(
        ctx.db,
        ctx.user.id,
        ctx.ipHash,
        input.id,
        'organization.updated',
        'organization',
        input.id,
        { name: input.name },
      );

      return organization;
    }),

  /**
   * Delete an organization.
   * Requires OWNER role. The organization must have no projects.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireOrganizationRole(ctx, input.id, 'OWNER');

      const projectCount = await ctx.db.project.count({
        where: { organizationId: input.id },
      });

      if (projectCount > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'Cannot delete an organization that still has projects. Delete all projects first.',
        });
      }

      await ctx.db.$transaction(async (tx) => {
        await tx.auditEvent.deleteMany({ where: { organizationId: input.id } });
        await tx.usageLedger.deleteMany({ where: { organizationId: input.id } });
        await tx.subscription.deleteMany({ where: { organizationId: input.id } });
        await tx.entitlement.deleteMany({ where: { organizationId: input.id } });
        await tx.backgroundJob.deleteMany({ where: { organizationId: input.id } });
        await tx.organization.delete({ where: { id: input.id } });
      });

      return { success: true as const };
    }),

  /**
   * Transfer organization ownership to another member.
   * The current owner is demoted to ADMIN; the target member is promoted to OWNER.
   * Requires OWNER role.
   */
  transferOwnership: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        newOwnerId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrganizationRole(ctx, input.organizationId, 'OWNER');

      const org = await ctx.db.organization.findUnique({
        where: { id: input.organizationId },
      });
      if (!org) throw new TRPCError({ code: 'NOT_FOUND' });

      if (input.newOwnerId === ctx.user.id) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'You are already the owner of this organization.',
        });
      }

      const targetMembership = await ctx.db.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.newOwnerId,
          },
        },
      });

      if (!targetMembership) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Target user is not a member of this organization.',
        });
      }

      const result = await ctx.db.$transaction(async (tx) => {
        // Demote current owner to ADMIN
        await tx.organizationMember.update({
          where: {
            organizationId_userId: {
              organizationId: input.organizationId,
              userId: ctx.user.id,
            },
          },
          data: { role: 'ADMIN' },
        });

        // Promote new owner
        await tx.organizationMember.update({
          where: {
            organizationId_userId: {
              organizationId: input.organizationId,
              userId: input.newOwnerId,
            },
          },
          data: { role: 'OWNER' },
        });

        // Update the organization record
        const updated = await tx.organization.update({
          where: { id: input.organizationId },
          data: { ownerId: input.newOwnerId },
        });

        await tx.auditEvent.create({
          data: {
            organizationId: input.organizationId,
            actorId: ctx.user.id,
            action: 'organization.ownership_transferred',
            targetType: 'organization',
            targetId: input.organizationId,
            metadata: { fromUserId: ctx.user.id, toUserId: input.newOwnerId },
            ipHash: ctx.ipHash,
          },
        });

        return updated;
      });

      return result;
    }),

  /**
   * List members of an organization.
   * Requires MEMBER role or higher.
   */
  listMembers: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireOrganizationRole(ctx, input.organizationId, 'MEMBER');

      const members = await ctx.db.organizationMember.findMany({
        where: { organizationId: input.organizationId },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      return members;
    }),

  /**
   * List pending invitations for an organization.
   * Requires ADMIN or OWNER role.
   */
  listInvites: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireOrganizationRole(ctx, input.organizationId, 'ADMIN');

      return ctx.db.organizationInvite.findMany({
        where: {
          organizationId: input.organizationId,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          role: true,
          expiresAt: true,
          createdAt: true,
        },
      });
    }),

  /**
   * Invite a user to join the organization.
   * Generates a single-use token for the invitation link.
   * Requires ADMIN or OWNER role.
   */
  invite: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        email: z.string().email(),
        role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrganizationRole(ctx, input.organizationId, 'ADMIN');

      const email = input.email.trim().toLowerCase();
      // Use case-insensitive lookup so Alice@Example.com and alice@example.com
      // are treated as the same user (matches auth.ts and the DB invite logic).
      const targetUser = await ctx.db.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      });
      if (targetUser) {
        const existingMember = await ctx.db.organizationMember.findUnique({
          where: {
            organizationId_userId: {
              organizationId: input.organizationId,
              userId: targetUser.id,
            },
          },
        });
        if (existingMember) {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'User is already a member of this organization.',
          });
        }
      }

      // Check for existing active invite for the same email
      const existingInvite = await ctx.db.organizationInvite.findFirst({
        where: {
          organizationId: input.organizationId,
          email: { equals: email, mode: 'insensitive' },
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
      if (existingInvite) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'An active invitation already exists for this email address.',
        });
      }

      const { token, tokenHash } = generateInviteToken();

      const invite = await ctx.db.organizationInvite.create({
        data: {
          organizationId: input.organizationId,
          email,
          role: input.role,
          tokenHash,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          invitedById: ctx.user.id,
        },
      });

      await createAuditEvent(
        ctx.db,
        ctx.user.id,
        ctx.ipHash,
        input.organizationId,
        'organization.invite_created',
        'organization_invite',
        invite.id,
        { email, role: input.role },
      );
      // Return the raw token so the caller can include it in an invitation link
      return { ...invite, token };
    }),

  /**
   * Accept an invitation using the token sent via email.
   * The authenticated user's email must match the invite email.
   * Creates a membership and marks the invite as accepted.
   */
  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tokenHash = crypto.createHash('sha256').update(input.token).digest('hex');

      const invite = await ctx.db.organizationInvite.findUnique({ where: { tokenHash } });

      if (!invite) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Invalid invitation token.' });
      }

      if (invite.acceptedAt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invitation has already been accepted.',
        });
      }

      if (invite.revokedAt) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invitation has been revoked.',
        });
      }

      if (invite.expiresAt < new Date()) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invitation has expired.',
        });
      }

      const sessionEmail = (ctx.user.email ?? '').trim().toLowerCase();
      if (invite.email !== sessionEmail) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This invitation was sent to a different email address.',
        });
      }

      // Check if the user is already a member (e.g. added by another means)
      const existingMember = await ctx.db.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: invite.organizationId,
            userId: ctx.user.id,
          },
        },
      });

      if (existingMember) {
        // Already a member — just mark the invite as accepted for record-keeping
        await ctx.db.organizationInvite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        });
        return { success: true as const, alreadyMember: true as const };
      }

      await ctx.db.$transaction(async (tx) => {
        const role = invite.role === 'OWNER' ? 'MEMBER' : invite.role;
        await tx.organizationMember.create({
          data: {
            organizationId: invite.organizationId,
            userId: ctx.user.id,
            role,
          },
        });

        await tx.organizationInvite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
        });

        await tx.auditEvent.create({
          data: {
            organizationId: invite.organizationId,
            actorId: ctx.user.id,
            action: 'organization.invite_accepted',
            targetType: 'organization_invite',
            targetId: invite.id,
            ipHash: ctx.ipHash,
          },
        });
      });

      return { success: true as const, alreadyMember: false as const };
    }),

  /**
   * Revoke a pending invitation.
   * Requires ADMIN or OWNER role.
   */
  revokeInvite: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        inviteId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireOrganizationRole(ctx, input.organizationId, 'ADMIN');

      const invite = await ctx.db.organizationInvite.findFirst({
        where: { id: input.inviteId, organizationId: input.organizationId },
      });

      if (!invite) throw new TRPCError({ code: 'NOT_FOUND' });
      if (invite.acceptedAt)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot revoke an accepted invitation.',
        });
      if (invite.revokedAt)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invitation has already been revoked.',
        });

      await ctx.db.organizationInvite.update({
        where: { id: input.inviteId },
        data: { revokedAt: new Date() },
      });

      await createAuditEvent(
        ctx.db,
        ctx.user.id,
        ctx.ipHash,
        input.organizationId,
        'organization.invite_revoked',
        'organization_invite',
        input.inviteId,
        { email: invite.email },
      );

      return { success: true as const };
    }),

  /**
   * Remove a member from the organization.
   * ADMIN can only remove MEMBERs; OWNER can remove any non-owner member.
   * The organization owner cannot be removed through this endpoint.
   */
  removeMember: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        userId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { role: callerRole } = await requireOrganizationRole(
        ctx,
        input.organizationId,
        'ADMIN',
      );

      const org = await ctx.db.organization.findUnique({
        where: { id: input.organizationId },
      });
      if (!org) throw new TRPCError({ code: 'NOT_FOUND' });

      // Prevent removing the organization owner
      if (org.ownerId === input.userId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Cannot remove the organization owner. Transfer ownership first.',
        });
      }

      const membership = await ctx.db.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.userId,
          },
        },
      });
      if (!membership) throw new TRPCError({ code: 'NOT_FOUND' });

      // ADMIN can only remove MEMBERs
      if (callerRole === 'ADMIN' && membership.role !== 'MEMBER') {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Admins can only remove members. Contact an owner to remove this user.',
        });
      }

      await ctx.db.organizationMember.delete({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.userId,
          },
        },
      });

      await createAuditEvent(
        ctx.db,
        ctx.user.id,
        ctx.ipHash,
        input.organizationId,
        'organization.member_removed',
        'organization_member',
        `${input.organizationId}_${input.userId}`,
        { removedUserId: input.userId, removedRole: membership.role },
      );

      return { success: true as const };
    }),

  /**
   * Update a member's role.
   * Only the organization OWNER can change roles.
   * Ownership changes must use transferOwnership.
   * Promotion to OWNER is not allowed through this endpoint.
   */
  updateMemberRole: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        userId: z.string().uuid(),
        role: OrganizationRole,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Only OWNER can change roles
      await requireOrganizationRole(ctx, input.organizationId, 'OWNER');

      const org = await ctx.db.organization.findUnique({
        where: { id: input.organizationId },
      });
      if (!org) throw new TRPCError({ code: 'NOT_FOUND' });

      // Cannot change the owner's role through this endpoint
      if (org.ownerId === input.userId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Use transferOwnership to change the organization owner.',
        });
      }

      // Cannot promote to OWNER through this endpoint
      if (input.role === 'OWNER') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Use transferOwnership to make someone the organization owner.',
        });
      }

      const membership = await ctx.db.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.userId,
          },
        },
      });
      if (!membership) throw new TRPCError({ code: 'NOT_FOUND' });

      const updated = await ctx.db.organizationMember.update({
        where: {
          organizationId_userId: {
            organizationId: input.organizationId,
            userId: input.userId,
          },
        },
        data: { role: input.role },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      await createAuditEvent(
        ctx.db,
        ctx.user.id,
        ctx.ipHash,
        input.organizationId,
        'organization.member_role_updated',
        'organization_member',
        `${input.organizationId}_${input.userId}`,
        { userId: input.userId, previousRole: membership.role, newRole: input.role },
      );

      return updated;
    }),
});
