// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Runs the real migrations against an in-memory Postgres: everything before
 * the Realms migration, then a set of team shapes, then the Realms migration.
 */
const MIGRATIONS_DIR = path.resolve(__dirname, '../../../../prisma/migrations');
const REALMS_MIGRATION = '20261019230000_replace_teams_with_realms';

function migrationSql(name: string): string {
  return readFileSync(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8');
}

const migrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const before = migrations.slice(0, migrations.indexOf(REALMS_MIGRATION));

const users = ['ann', 'ben', 'cal', 'dee', 'eve', 'fay', 'gus'];

async function seedTeams(db: PGlite) {
  for (const id of users) {
    await db.query(`INSERT INTO users (id, email, name, updated_at) VALUES ($1, $2, $3, now())`, [
      id,
      `${id}@example.com`,
      id,
    ]);
  }
  const org = (id: string, owner: string, created: string) =>
    db.query(
      `INSERT INTO organizations (id, name, slug, owner_id, created_at, updated_at)
       VALUES ($1, $2, $1, $3, $4, now())`,
      [id, `${owner}'s Workspace`, owner, created],
    );
  const member = (orgId: string, userId: string, role: string) =>
    db.query(
      `INSERT INTO organization_members (organization_id, user_id, role, updated_at)
       VALUES ($1, $2, $3, now())`,
      [orgId, userId, role],
    );
  const project = (id: string, orgId: string, owner: string) =>
    db.query(
      `INSERT INTO projects (id, owner_id, organization_id, slug, updated_at)
       VALUES ($1, $2, $3, $1, now())`,
      [id, owner, orgId],
    );

  // Ann's workspace became a team: Ben admin, Cal member. Ann has no other.
  await org('org-ann', 'ann', '2026-01-01');
  await member('org-ann', 'ann', 'OWNER');
  await member('org-ann', 'ben', 'ADMIN');
  await member('org-ann', 'cal', 'MEMBER');
  await project('p-team', 'org-ann', 'cal');
  // Ben also has his own solo workspace.
  await org('org-ben', 'ben', '2026-01-02');
  await member('org-ben', 'ben', 'OWNER');
  await project('p-ben', 'org-ben', 'ben');
  // Dee owns two solo workspaces; the older one is her personal Realm.
  await org('org-dee-1', 'dee', '2026-01-03');
  await member('org-dee-1', 'dee', 'OWNER');
  await org('org-dee-2', 'dee', '2026-01-04');
  await member('org-dee-2', 'dee', 'OWNER');
  await project('p-dee-2', 'org-dee-2', 'dee');
  // Gus collaborated on Dee's second workspace's project.
  await db.query(
    `INSERT INTO project_collaborators (project_id, user_id, role) VALUES ('p-dee-2', 'gus', 'EDITOR')`,
  );
  // Eve's solo workspace has a pending invite: she was building a team.
  await org('org-eve', 'eve', '2026-01-05');
  await member('org-eve', 'eve', 'OWNER');
  await db.query(
    `INSERT INTO organization_invites (id, organization_id, email, role, token_hash, expires_at, invited_by_id)
     VALUES ('inv-eve', 'org-eve', 'x@example.com', 'MEMBER', 'h1', now() + interval '3 days', 'eve'),
            ('inv-old', 'org-eve', 'y@example.com', 'ADMIN', 'h2', now() - interval '3 days', 'eve')`,
  );
  await db.query(
    `INSERT INTO organization_invites (id, organization_id, email, role, token_hash, expires_at, invited_by_id, accepted_at)
     VALUES ('inv-done', 'org-ann', 'cal@example.com', 'MEMBER', 'h3', now(), 'ann', now())`,
  );
  // Fay never got a workspace.

  await db.query(
    `INSERT INTO api_keys (id, user_id, provider, encrypted_key, label) VALUES
       ('k-ann', 'ann', 'openai', 'enc', NULL),
       ('k-cal', 'cal', 'anthropic', 'enc', 'work')`,
  );
  await db.query(
    `INSERT INTO image_provider_configs (id, user_id, encrypted_key, base_url, model, updated_at)
     VALUES ('img-ann', 'ann', 'enc', 'https://api.example.com', 'm', now())`,
  );
  await db.query(
    `INSERT INTO audit_events (id, organization_id, actor_id, action, target_type)
     VALUES ('a1', 'org-ann', 'ann', 'organization.invite_accepted', 'organization_invite')`,
  );
}

describe('replace_teams_with_realms migration', () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    for (const name of before) await db.exec(migrationSql(name));
    await seedTeams(db);
    await db.exec(migrationSql(REALMS_MIGRATION));
  }, 60_000);

  async function rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await db.query<T>(sql, params)).rows;
  }

  async function realmsOf(userId: string) {
    return rows<{ id: string; name: string; type: string; role: string }>(
      `SELECT r.id, r.name, r.type, m.role FROM realm_members m
       JOIN realms r ON r.id = m.realm_id WHERE m.user_id = $1 ORDER BY r.type, r.id`,
      [userId],
    );
  }

  async function personalRealmId(userId: string): Promise<string> {
    const [row] = await rows<{ id: string }>(
      `SELECT id FROM realms WHERE owner_id = $1 AND type = 'PERSONAL'`,
      [userId],
    );
    return row!.id;
  }

  it('gives every user exactly one personal Realm that only they belong to', async () => {
    const personal = await rows<{ owner_id: string; members: number; name: string }>(
      `SELECT r.owner_id, r.name, count(m.user_id)::int AS members FROM realms r
       JOIN realm_members m ON m.realm_id = r.id WHERE r.type = 'PERSONAL'
       GROUP BY r.id ORDER BY r.owner_id`,
    );
    expect(personal.map((p) => p.owner_id)).toEqual([...users].sort());
    expect(personal.every((p) => p.members === 1 && p.name === 'Personal')).toBe(true);
  });

  it('turns a team into a shared Realm with the same members and roles', async () => {
    const team = await rows<{ user_id: string; role: string }>(
      `SELECT m.user_id, m.role FROM realm_members m JOIN realms r ON r.id = m.realm_id
       WHERE r.id = 'org-ann' ORDER BY m.user_id`,
    );
    expect(team).toEqual([
      { user_id: 'ann', role: 'OWNER' },
      { user_id: 'ben', role: 'ADMIN' },
      { user_id: 'cal', role: 'MEMBER' },
    ]);
    const [realm] = await rows<{ type: string; name: string }>(
      `SELECT type, name FROM realms WHERE id = 'org-ann'`,
    );
    expect(realm).toEqual({ type: 'SHARED', name: "ann's Workspace" });
  });

  it("keeps a team's projects in the shared Realm and solo projects in the personal one", async () => {
    const projects = await rows<{ id: string; realm_id: string }>(
      `SELECT id, realm_id FROM projects ORDER BY id`,
    );
    expect(projects).toEqual([
      { id: 'p-ben', realm_id: 'org-ben' },
      { id: 'p-dee-2', realm_id: 'org-dee-2' },
      { id: 'p-team', realm_id: 'org-ann' },
    ]);
    expect(await personalRealmId('ben')).toBe('org-ben');
  });

  it('creates a personal Realm for users whose workspace became a team or who had none', async () => {
    expect((await realmsOf('ann')).map((r) => [r.type, r.role])).toEqual([
      ['PERSONAL', 'OWNER'],
      ['SHARED', 'OWNER'],
    ]);
    expect((await realmsOf('cal')).map((r) => [r.type, r.role])).toEqual([
      ['PERSONAL', 'OWNER'],
      ['SHARED', 'MEMBER'],
    ]);
    expect((await realmsOf('fay')).map((r) => r.type)).toEqual(['PERSONAL']);
  });

  it("uses a user's oldest solo workspace as personal and keeps the rest", async () => {
    expect(await personalRealmId('dee')).toBe('org-dee-1');
    const [second] = await rows<{ type: string }>(`SELECT type FROM realms WHERE id = 'org-dee-2'`);
    expect(second?.type).toBe('SHARED');
  });

  it('keeps project collaborators as members of the project Realm', async () => {
    expect(await realmsOf('gus')).toContainEqual(
      expect.objectContaining({ id: 'org-dee-2', role: 'MEMBER' }),
    );
    const tables = await rows(`SELECT 1 FROM pg_tables WHERE tablename = 'project_collaborators'`);
    expect(tables).toHaveLength(0);
  });

  it('treats a workspace with a pending invite as shared', async () => {
    const [eve] = await rows<{ type: string }>(`SELECT type FROM realms WHERE id = 'org-eve'`);
    expect(eve?.type).toBe('SHARED');
    expect((await realmsOf('eve')).map((r) => r.type)).toEqual(['PERSONAL', 'SHARED']);
  });

  it('maps invite timestamps to a status', async () => {
    const invites = await rows<{ id: string; status: string }>(
      `SELECT id, status FROM realm_invites ORDER BY id`,
    );
    expect(invites).toEqual([
      { id: 'inv-done', status: 'ACCEPTED' },
      { id: 'inv-eve', status: 'PENDING' },
      { id: 'inv-old', status: 'PENDING' },
    ]);
  });

  it("moves provider keys into their owner's personal Realm", async () => {
    const keys = await rows<{ id: string; realm_id: string }>(
      `SELECT id, realm_id FROM api_keys ORDER BY id`,
    );
    expect(keys).toEqual([
      { id: 'k-ann', realm_id: await personalRealmId('ann') },
      { id: 'k-cal', realm_id: await personalRealmId('cal') },
    ]);
    const [image] = await rows<{ realm_id: string }>(`SELECT realm_id FROM image_provider_configs`);
    expect(image?.realm_id).toBe(await personalRealmId('ann'));
  });

  it('renames audit history from organization to realm', async () => {
    const [event] = await rows<{ realm_id: string; action: string; target_type: string }>(
      `SELECT realm_id, action, target_type FROM audit_events`,
    );
    expect(event).toEqual({
      realm_id: 'org-ann',
      action: 'realm.invite_accepted',
      target_type: 'realm_invite',
    });
  });

  it('leaves no organization tables, columns or types behind', async () => {
    const leftovers = await rows(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND (table_name LIKE 'organization%' OR column_name LIKE 'organization%')`,
    );
    expect(leftovers).toEqual([]);
    const types = await rows(
      `SELECT typname FROM pg_type WHERE typname IN ('organization_role', 'project_role')`,
    );
    expect(types).toEqual([]);
  });
});
