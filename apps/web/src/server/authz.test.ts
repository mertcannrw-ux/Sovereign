// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import {
  requireOrganizationRole,
  requireProjectRole,
  requireProjectEditor,
  requireProjectOwner,
  requireProjectViewer,
} from './authz';
import type { AuthzContext } from './authz';

/**
 * Minimal fake of the two Prisma delegates authz touches. Only the query shapes
 * authz actually issues are implemented, so a change in how authz queries the
 * database breaks these tests loudly rather than silently passing.
 */
function makeCtx(options: {
  userId?: string | null;
  project?: { id: string; ownerId: string; organizationId: string } | null;
  collaborator?: { role: 'OWNER' | 'EDITOR' | 'VIEWER' } | null;
  membership?: { role: 'OWNER' | 'ADMIN' | 'MEMBER' } | null;
}): AuthzContext {
  const { userId = 'user-1', project = null, collaborator = null, membership = null } = options;

  return {
    user: userId === null ? null : ({ id: userId } as AuthzContext['user']),
    db: {
      project: { findUnique: vi.fn(async () => project) },
      projectCollaborator: { findUnique: vi.fn(async () => collaborator) },
      organizationMember: { findUnique: vi.fn(async () => membership) },
    },
  } as unknown as AuthzContext;
}

async function expectTrpcError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toBeInstanceOf(TRPCError);
  await promise.catch((error: TRPCError) => expect(error.code).toBe(code));
}

describe('requireOrganizationRole', () => {
  it('rejects an anonymous caller', async () => {
    const ctx = makeCtx({ userId: null, membership: { role: 'OWNER' } });
    await expectTrpcError(requireOrganizationRole(ctx, 'org-1', 'MEMBER'), 'UNAUTHORIZED');
  });

  it('hides non-membership as NOT_FOUND', async () => {
    const ctx = makeCtx({ membership: null });
    await expectTrpcError(requireOrganizationRole(ctx, 'org-1', 'MEMBER'), 'NOT_FOUND');
  });

  it('enforces the role hierarchy', async () => {
    const member = makeCtx({ membership: { role: 'MEMBER' } });
    await expectTrpcError(requireOrganizationRole(member, 'org-1', 'ADMIN'), 'FORBIDDEN');

    const admin = makeCtx({ membership: { role: 'ADMIN' } });
    await expect(requireOrganizationRole(admin, 'org-1', 'ADMIN')).resolves.toEqual({
      role: 'ADMIN',
    });
    await expectTrpcError(requireOrganizationRole(admin, 'org-1', 'OWNER'), 'FORBIDDEN');

    const owner = makeCtx({ membership: { role: 'OWNER' } });
    await expect(requireOrganizationRole(owner, 'org-1', 'OWNER')).resolves.toEqual({
      role: 'OWNER',
    });
  });
});

describe('requireProjectRole', () => {
  const project = { id: 'proj-1', ownerId: 'owner-1', organizationId: 'org-1' };

  it('rejects an anonymous caller', async () => {
    const ctx = makeCtx({ userId: null, project });
    await expectTrpcError(requireProjectRole(ctx, 'proj-1', 'VIEWER'), 'UNAUTHORIZED');
  });

  it('returns NOT_FOUND for a project the caller cannot see', async () => {
    const ctx = makeCtx({ project: null });
    await expectTrpcError(requireProjectRole(ctx, 'missing', 'VIEWER'), 'NOT_FOUND');
  });

  it('grants the project owner full access', async () => {
    const ctx = makeCtx({ userId: 'owner-1', project });
    await expect(requireProjectOwner(ctx, 'proj-1')).resolves.toEqual({
      organizationId: 'org-1',
    });
  });

  it('honours collaborator roles', async () => {
    const viewer = makeCtx({ project, collaborator: { role: 'VIEWER' } });
    await expect(requireProjectViewer(viewer, 'proj-1')).resolves.toEqual({
      organizationId: 'org-1',
    });
    await expectTrpcError(requireProjectEditor(viewer, 'proj-1'), 'FORBIDDEN');
    await expectTrpcError(requireProjectOwner(viewer, 'proj-1'), 'FORBIDDEN');

    const editor = makeCtx({ project, collaborator: { role: 'EDITOR' } });
    await expect(requireProjectEditor(editor, 'proj-1')).resolves.toEqual({
      organizationId: 'org-1',
    });
    await expectTrpcError(requireProjectOwner(editor, 'proj-1'), 'FORBIDDEN');
  });

  it('lets an org OWNER administer any project in the organization', async () => {
    const ctx = makeCtx({ userId: 'org-owner', project, membership: { role: 'OWNER' } });
    await expect(requireProjectOwner(ctx, 'proj-1')).resolves.toEqual({
      organizationId: 'org-1',
    });
  });

  it('maps an org ADMIN to project EDITOR, not OWNER', async () => {
    const ctx = makeCtx({ userId: 'org-admin', project, membership: { role: 'ADMIN' } });
    await expect(requireProjectEditor(ctx, 'proj-1')).resolves.toEqual({
      organizationId: 'org-1',
    });
    // An org admin must not be able to delete the project or transfer it.
    await expectTrpcError(requireProjectOwner(ctx, 'proj-1'), 'FORBIDDEN');
  });

  it('does not let a plain org MEMBER reach an unrelated project', async () => {
    const ctx = makeCtx({ userId: 'org-member', project, membership: { role: 'MEMBER' } });
    await expectTrpcError(requireProjectRole(ctx, 'proj-1', 'VIEWER'), 'NOT_FOUND');
  });

  it('prefers the collaborator row over a lower org role', async () => {
    // Org MEMBER would be denied, but the explicit collaborator grant wins.
    const ctx = makeCtx({
      userId: 'user-2',
      project,
      collaborator: { role: 'EDITOR' },
      membership: { role: 'MEMBER' },
    });
    await expect(requireProjectEditor(ctx, 'proj-1')).resolves.toEqual({
      organizationId: 'org-1',
    });
  });
});
