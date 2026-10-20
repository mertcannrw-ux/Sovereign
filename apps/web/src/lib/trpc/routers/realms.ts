import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import crypto from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma-generated/prisma/client';
import { protectedProcedure, router } from '../trpc';
import { hasRealmRole, requireRealmRole } from '@/server/authz';
import { lockRealm } from '@/server/realm-lock';
import { appUrl, sendEmail } from '@/server/email';
import type { RealmRole } from '@app-builder/shared';

// ─── Helpers ──────────────────────────────────────────────

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function generateInviteToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, tokenHash: hashInviteToken(token) };
}

function hashInviteToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function inviteLink(token: string): string {
  return appUrl(`/invite/${token}`);
}

/** The slice of the client that both `PrismaClient` and a transaction satisfy. */
type AuditEventDb = Pick<PrismaClient, 'auditEvent'>;

async function createAuditEvent(
  db: AuditEventDb,
  actorId: string,
  ipHash: string,
  realmId: string,
  action: string,
  targetType: string,
  targetId?: string,
  metadata?: Prisma.InputJsonValue,
): Promise<void> {
  await db.auditEvent.create({
    data: {
      realmId,
      actorId,
      action,
      targetType,
      targetId: targetId ?? null,
      metadata,
      ipHash,
    },
  });
}

/**
 * Whether `actor` may change or remove `target`. Nobody touches the owner here
 * (ownership moves only by transfer), and below the owner an Admin manages
 * Admins and Members alike.
 */
export function canManageMember(actor: RealmRole, target: RealmRole): boolean {
  return target !== 'OWNER' && hasRealmRole(actor, 'ADMIN');
}

/** Members are only invited into shared Realms; a personal Realm is yours alone. */
async function requireSharedRealm(ctx: Parameters<typeof requireRealmRole>[0], realmId: string) {
  const access = await requireRealmRole(ctx, realmId, 'ADMIN');
  if (access.realmType !== 'SHARED') {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'This is your personal Realm. Create a shared Realm to build with others.',
    });
  }
  return access;
}

async function sendInviteEmail(options: {
  to: string;
  realmName: string;
  inviterName: string;
  token: string;
}): Promise<boolean> {
  const link = inviteLink(options.token);
  return sendEmail({
    to: options.to,
    subject: `${options.inviterName} invited you to ${options.realmName} on Sovereign`,
    html: `<p>${escapeHtml(options.inviterName)} invited you to build in <strong>${escapeHtml(
      options.realmName,
    )}</strong> on Sovereign.</p><p><a href="${link}">Join ${escapeHtml(
      options.realmName,
    )}</a></p><p>This link works for 7 days.</p>`,
    devLink: link,
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const pendingInviteWhere = (realmId: string) => ({
  realmId,
  status: 'PENDING' as const,
  expiresAt: { gt: new Date() },
});

// ─── Router ───────────────────────────────────────────────

export const realmsRouter = router({
  /**
   * Every Realm the caller belongs to, personal first, with their role in it.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.db.realmMember.findMany({
      where: { userId: ctx.user.id },
      select: {
        role: true,
        realm: {
          select: {
            id: true,
            name: true,
            type: true,
            createdAt: true,
            _count: { select: { members: true } },
          },
        },
      },
      orderBy: { realm: { createdAt: 'asc' } },
    });

    return memberships
      .map((m) => ({
        id: m.realm.id,
        name: m.realm.name,
        type: m.realm.type,
        createdAt: m.realm.createdAt,
        memberCount: m.realm._count.members,
        role: m.role,
      }))
      .sort((a, b) => Number(b.type === 'PERSONAL') - Number(a.type === 'PERSONAL'));
  }),

  /** One Realm, for members only. */
  get: protectedProcedure
    .input(z.object({ realmId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { role } = await requireRealmRole(ctx, input.realmId, 'MEMBER');
      const realm = await ctx.db.realm.findUniqueOrThrow({
        where: { id: input.realmId },
        select: { id: true, name: true, type: true, createdAt: true },
      });
      return { ...realm, role };
    }),

  /** Create a shared Realm owned by the caller. */
  create: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.$transaction(async (tx) => {
        const realm = await tx.realm.create({
          data: {
            name: input.name,
            type: 'SHARED',
            ownerId: ctx.user.id,
            members: { create: { userId: ctx.user.id, role: 'OWNER' } },
          },
          select: { id: true, name: true, type: true },
        });
        await createAuditEvent(
          tx,
          ctx.user.id,
          ctx.ipHash,
          realm.id,
          'realm.created',
          'realm',
          realm.id,
        );
        return realm;
      });
    }),

  /** Rename a shared Realm. Owner/Admin. */
  rename: protectedProcedure
    .input(z.object({ realmId: z.string().uuid(), name: z.string().trim().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      await requireSharedRealm(ctx, input.realmId);
      const realm = await ctx.db.realm.update({
        where: { id: input.realmId },
        data: { name: input.name },
        select: { id: true, name: true },
      });
      await createAuditEvent(
        ctx.db,
        ctx.user.id,
        ctx.ipHash,
        input.realmId,
        'realm.renamed',
        'realm',
        input.realmId,
        { name: input.name },
      );
      return realm;
    }),

  /**
   * Delete a shared Realm. Owner only, and only once its projects are gone.
   * A personal Realm goes with its account, never on its own.
   */
  delete: protectedProcedure
    .input(z.object({ realmId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { realmType } = await requireRealmRole(ctx, input.realmId, 'OWNER');
      if (realmType !== 'SHARED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Your personal Realm cannot be deleted.',
        });
      }

      const projectCount = await ctx.db.project.count({ where: { realmId: input.realmId } });
      if (projectCount > 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Delete or move every project in this Realm first.',
        });
      }

      await ctx.db.$transaction(async (tx) => {
        await tx.auditEvent.deleteMany({ where: { realmId: input.realmId } });
        await tx.usageLedger.deleteMany({ where: { realmId: input.realmId } });
        await tx.subscription.deleteMany({ where: { realmId: input.realmId } });
        await tx.entitlement.deleteMany({ where: { realmId: input.realmId } });
        await tx.backgroundJob.deleteMany({ where: { realmId: input.realmId } });
        await tx.realm.delete({ where: { id: input.realmId } });
      });

      return { success: true as const };
    }),

  /**
   * Hand the Realm to another member. The current owner becomes an Admin, so
   * there is exactly one owner before and after. Owner only.
   */
  transferOwnership: protectedProcedure
    .input(z.object({ realmId: z.string().uuid(), newOwnerId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { realmType } = await requireRealmRole(ctx, input.realmId, 'OWNER');
      if (realmType !== 'SHARED') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A personal Realm cannot change hands.',
        });
      }
      if (input.newOwnerId === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'You already own this Realm.' });
      }

      return ctx.db.$transaction(async (tx) => {
        // Lock the Realm row so two transfers cannot both pass the owner check.
        await tx.$executeRaw`SELECT id FROM realms WHERE id = ${input.realmId} FOR UPDATE`;
        const locked = await tx.realm.findUnique({
          where: { id: input.realmId },
          select: { ownerId: true },
        });
        if (!locked || locked.ownerId !== ctx.user.id) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Only the current owner can transfer ownership.',
          });
        }

        const target = await tx.realmMember.findUnique({
          where: { realmId_userId: { realmId: input.realmId, userId: input.newOwnerId } },
        });
        if (!target) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'That person is not a member.' });
        }

        await tx.realmMember.update({
          where: { realmId_userId: { realmId: input.realmId, userId: ctx.user.id } },
          data: { role: 'ADMIN' },
        });
        await tx.realmMember.update({
          where: { realmId_userId: { realmId: input.realmId, userId: input.newOwnerId } },
          data: { role: 'OWNER' },
        });
        await tx.realm.update({
          where: { id: input.realmId },
          data: { ownerId: input.newOwnerId },
        });
        await createAuditEvent(
          tx,
          ctx.user.id,
          ctx.ipHash,
          input.realmId,
          'realm.ownership_transferred',
          'realm',
          input.realmId,
          { fromUserId: ctx.user.id, toUserId: input.newOwnerId },
        );
        return { success: true as const };
      });
    }),

  /** Everyone in the Realm. Any member can see who they build with. */
  listMembers: protectedProcedure
    .input(z.object({ realmId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireRealmRole(ctx, input.realmId, 'MEMBER');
      const members = await ctx.db.realmMember.findMany({
        where: { realmId: input.realmId },
        select: {
          userId: true,
          role: true,
          user: { select: { name: true, email: true, avatarUrl: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      const rank: Record<RealmRole, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2 };
      return members.sort((a, b) => rank[a.role] - rank[b.role]);
    }),

  /** Invitations still waiting for an answer. Owner/Admin. */
  listInvites: protectedProcedure
    .input(z.object({ realmId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireRealmRole(ctx, input.realmId, 'ADMIN');
      return ctx.db.realmInvite.findMany({
        where: pendingInviteWhere(input.realmId),
        orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
      });
    }),

  /**
   * Invite someone by email. Re-inviting an address that already has a
   * pending invite replaces its link (the old one stops working) instead of
   * failing. With `sendEmail: false` nothing is mailed and the caller shares
   * the returned link themselves ("Copy invite link"). Owner/Admin.
   */
  invite: protectedProcedure
    .input(
      z.object({
        realmId: z.string().uuid(),
        email: z.string().trim().email(),
        role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
        sendEmail: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireSharedRealm(ctx, input.realmId);
      const email = input.email.toLowerCase();

      const alreadyMember = await ctx.db.realmMember.findFirst({
        where: {
          realmId: input.realmId,
          user: { email: { equals: email, mode: 'insensitive' } },
        },
        select: { userId: true },
      });
      if (alreadyMember) {
        throw new TRPCError({ code: 'CONFLICT', message: 'They are already a member.' });
      }

      const { token, tokenHash } = generateInviteToken();
      const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
      const existing = await ctx.db.realmInvite.findFirst({
        where: { ...pendingInviteWhere(input.realmId), email },
        select: { id: true },
      });
      const invite = existing
        ? await ctx.db.realmInvite.update({
            where: { id: existing.id },
            data: { role: input.role, tokenHash, expiresAt, invitedById: ctx.user.id },
          })
        : await ctx.db.realmInvite.create({
            data: {
              realmId: input.realmId,
              email,
              role: input.role,
              tokenHash,
              expiresAt,
              invitedById: ctx.user.id,
            },
          });

      await createAuditEvent(
        ctx.db,
        ctx.user.id,
        ctx.ipHash,
        input.realmId,
        'realm.invite_created',
        'realm_invite',
        invite.id,
        { email, role: input.role },
      );

      let emailed = false;
      if (input.sendEmail) {
        const realm = await ctx.db.realm.findUniqueOrThrow({
          where: { id: input.realmId },
          select: { name: true },
        });
        emailed = await sendInviteEmail({
          to: email,
          realmName: realm.name,
          inviterName: ctx.user.name ?? ctx.user.email ?? 'A teammate',
          token,
        });
      }

      return { id: invite.id, email, role: invite.role, link: inviteLink(token), emailed };
    }),

  /** Send a pending invite again with a fresh link and a new 7-day window. Owner/Admin. */
  resendInvite: protectedProcedure
    .input(z.object({ realmId: z.string().uuid(), inviteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireSharedRealm(ctx, input.realmId);
      const { token, tokenHash } = generateInviteToken();
      const updated = await ctx.db.realmInvite.updateMany({
        where: { id: input.inviteId, realmId: input.realmId, status: 'PENDING' },
        data: { tokenHash, expiresAt: new Date(Date.now() + INVITE_TTL_MS) },
      });
      if (updated.count === 0) throw new TRPCError({ code: 'NOT_FOUND' });

      const invite = await ctx.db.realmInvite.findUniqueOrThrow({
        where: { id: input.inviteId },
        select: { email: true, realm: { select: { name: true } } },
      });
      const emailed = await sendInviteEmail({
        to: invite.email,
        realmName: invite.realm.name,
        inviterName: ctx.user.name ?? ctx.user.email ?? 'A teammate',
        token,
      });
      return { emailed, link: inviteLink(token) };
    }),

  /** Withdraw a pending invite; its link stops working. Owner/Admin. */
  revokeInvite: protectedProcedure
    .input(z.object({ realmId: z.string().uuid(), inviteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireRealmRole(ctx, input.realmId, 'ADMIN');
      // Conditional write: a concurrent accept flips the status first and the
      // revoke then matches nothing, instead of overwriting the acceptance.
      const revoked = await ctx.db.realmInvite.updateMany({
        where: { id: input.inviteId, realmId: input.realmId, status: 'PENDING' },
        data: { status: 'REVOKED' },
      });
      if (revoked.count === 0) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This invite was already accepted or withdrawn.',
        });
      }
      await createAuditEvent(
        ctx.db,
        ctx.user.id,
        ctx.ipHash,
        input.realmId,
        'realm.invite_revoked',
        'realm_invite',
        input.inviteId,
      );
      return { success: true as const };
    }),

  /**
   * What an invite link points at, so the invite page can say where it leads
   * before the person joins. Signed in as anyone but the invited address, the
   * holder of the link learns only which address to sign in with.
   */
  inviteDetails: protectedProcedure
    .input(z.object({ token: z.string().min(1).max(200) }))
    .query(async ({ ctx, input }) => {
      const invite = await ctx.db.realmInvite.findUnique({
        where: { tokenHash: hashInviteToken(input.token) },
        select: {
          email: true,
          role: true,
          status: true,
          expiresAt: true,
          realmId: true,
          realm: { select: { name: true } },
          invitedBy: { select: { name: true, email: true } },
        },
      });
      if (!invite) return { state: 'invalid' as const };
      if ((ctx.user.email ?? '').toLowerCase() !== invite.email) {
        return { state: 'wrong-account' as const, email: invite.email };
      }
      if (invite.status === 'REVOKED') return { state: 'invalid' as const };
      if (invite.status === 'ACCEPTED') {
        return { state: 'accepted' as const, realmId: invite.realmId };
      }
      if (invite.expiresAt < new Date()) return { state: 'expired' as const };
      return {
        state: 'pending' as const,
        realmId: invite.realmId,
        realmName: invite.realm.name,
        role: invite.role,
        invitedBy: invite.invitedBy.name ?? invite.invitedBy.email,
      };
    }),

  /**
   * Join a Realm through an invite. The signed-in account's email must be the
   * invited one.
   */
  acceptInvite: protectedProcedure
    .input(z.object({ token: z.string().min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const invite = await ctx.db.realmInvite.findUnique({
        where: { tokenHash: hashInviteToken(input.token) },
      });
      if (!invite || invite.status === 'REVOKED') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'This invite link is not valid.' });
      }
      if ((ctx.user.email ?? '').trim().toLowerCase() !== invite.email) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'This invite was sent to a different email address.',
        });
      }

      // The status flip is the arbiter between concurrent accepts and a
      // concurrent revoke: only the writer that moves PENDING -> ACCEPTED adds
      // the membership.
      return ctx.db.$transaction(async (tx) => {
        const accepted = await tx.realmInvite.updateMany({
          where: { id: invite.id, status: 'PENDING', expiresAt: { gt: new Date() } },
          data: { status: 'ACCEPTED' },
        });
        if (accepted.count === 0) {
          const member = await tx.realmMember.findUnique({
            where: { realmId_userId: { realmId: invite.realmId, userId: ctx.user.id } },
          });
          if (member) return { realmId: invite.realmId };
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'This invite has expired or was withdrawn. Ask for a new one.',
          });
        }

        await tx.realmMember.upsert({
          where: { realmId_userId: { realmId: invite.realmId, userId: ctx.user.id } },
          create: {
            realmId: invite.realmId,
            userId: ctx.user.id,
            role: invite.role === 'OWNER' ? 'MEMBER' : invite.role,
          },
          update: {},
        });
        await createAuditEvent(
          tx,
          ctx.user.id,
          ctx.ipHash,
          invite.realmId,
          'realm.invite_accepted',
          'realm_invite',
          invite.id,
        );
        return { realmId: invite.realmId };
      });
    }),

  /**
   * Remove someone from the Realm. Owner/Admin; the owner cannot be removed.
   * Their projects stay in the Realm, as everyone's work does.
   */
  removeMember: protectedProcedure
    .input(z.object({ realmId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { role } = await requireRealmRole(ctx, input.realmId, 'ADMIN');
      const membership = await ctx.db.realmMember.findUnique({
        where: { realmId_userId: { realmId: input.realmId, userId: input.userId } },
      });
      if (!membership) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!canManageMember(role, membership.role)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'The owner cannot be removed. Transfer ownership first.',
        });
      }

      await ctx.db.$transaction(async (tx) => {
        // Same lock as project creation, so a request already in flight from
        // the person being removed cannot add a project after they are gone.
        await lockRealm(tx, input.realmId);
        await tx.realmMember.delete({
          where: { realmId_userId: { realmId: input.realmId, userId: input.userId } },
        });
        await createAuditEvent(
          tx,
          ctx.user.id,
          ctx.ipHash,
          input.realmId,
          'realm.member_removed',
          'realm_member',
          input.userId,
          { removedRole: membership.role },
        );
      });
      return { success: true as const };
    }),

  /**
   * Make someone an Admin or a Member. Owner/Admin; the owner's role only
   * changes through a transfer.
   */
  updateMemberRole: protectedProcedure
    .input(
      z.object({
        realmId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(['ADMIN', 'MEMBER']),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { role } = await requireRealmRole(ctx, input.realmId, 'ADMIN');
      const membership = await ctx.db.realmMember.findUnique({
        where: { realmId_userId: { realmId: input.realmId, userId: input.userId } },
      });
      if (!membership) throw new TRPCError({ code: 'NOT_FOUND' });
      if (!canManageMember(role, membership.role)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: "The owner's role changes only by transferring ownership.",
        });
      }

      const updated = await ctx.db.realmMember.update({
        where: { realmId_userId: { realmId: input.realmId, userId: input.userId } },
        data: { role: input.role },
        select: { userId: true, role: true },
      });
      await createAuditEvent(
        ctx.db,
        ctx.user.id,
        ctx.ipHash,
        input.realmId,
        'realm.member_role_updated',
        'realm_member',
        input.userId,
        { previousRole: membership.role, newRole: input.role },
      );
      return updated;
    }),
});
