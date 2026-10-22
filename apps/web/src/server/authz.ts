import { TRPCError } from '@trpc/server';
import type { Context } from '@/lib/trpc/context';
import type { RealmRole, RealmType } from '@app-builder/shared';

/** The subset of the tRPC context these checks need, so raw route handlers
 * (which have session + db but no full tRPC context) can reuse them too. */
export type AuthzContext = Pick<Context, 'user' | 'db'>;

// ─── Role hierarchy (higher = more permissions) ───────────

const REALM_ROLE_RANK: Record<RealmRole, number> = {
  MEMBER: 0,
  ADMIN: 1,
  OWNER: 2,
};

export function hasRealmRole(role: RealmRole, minimum: RealmRole): boolean {
  return REALM_ROLE_RANK[role] >= REALM_ROLE_RANK[minimum];
}

export interface RealmAccess {
  realmId: string;
  role: RealmRole;
  realmType: RealmType;
}

// ─── Realm-level authorization ────────────────────────────

/**
 * The caller's role in a Realm, or an error. A non-member gets NOT_FOUND, not
 * FORBIDDEN, so a Realm's existence is never revealed to outsiders.
 */
export async function requireRealmRole(
  ctx: AuthzContext,
  realmId: string,
  minimumRole: RealmRole,
): Promise<RealmAccess> {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  const membership = await ctx.db.realmMember.findUnique({
    where: { realmId_userId: { realmId, userId: ctx.user.id } },
    select: { role: true, realm: { select: { type: true } } },
  });

  if (!membership) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }

  if (!hasRealmRole(membership.role, minimumRole)) {
    throw new TRPCError({ code: 'FORBIDDEN' });
  }

  return { realmId, role: membership.role, realmType: membership.realm.type };
}

// ─── Realm keys ───────────────────────────────────────────

/**
 * Whether `userId` may replace or remove a Realm key (AI or image provider)
 * that `addedById` added: the Owner any key, an Admin only their own, a Member
 * none. The same test decides who sees a key's masked form and endpoint.
 */
export function canManageKey(role: RealmRole, addedById: string, userId: string): boolean {
  return role === 'OWNER' || (role === 'ADMIN' && addedById === userId);
}

/** Refusal for touching a key someone else added, naming who can. */
export function keyAddedByOtherError(addedBy: string): TRPCError {
  return new TRPCError({
    code: 'FORBIDDEN',
    message: `${addedBy} added this key. Only they or the Realm owner can change or remove it.`,
  });
}

// ─── Project-level authorization ──────────────────────────

/**
 * Access to a project is access to its Realm: every member can open, edit and
 * build it. Being the project's creator grants nothing on its own, so someone
 * removed from a Realm loses its projects with it.
 */
export async function requireProjectAccess(
  ctx: AuthzContext,
  projectId: string,
  minimumRole: RealmRole = 'MEMBER',
): Promise<RealmAccess & { ownerId: string }> {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }

  const project = await ctx.db.project.findUnique({
    where: { id: projectId },
    select: { realmId: true, ownerId: true },
  });

  if (!project) {
    throw new TRPCError({ code: 'NOT_FOUND' });
  }

  const access = await requireRealmRole(ctx, project.realmId, minimumRole);
  return { ...access, ownerId: project.ownerId };
}
