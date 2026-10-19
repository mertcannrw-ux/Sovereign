-- Realms replace Teams. Organizations become Realms in place (renamed, never
-- copied), so every id, membership, project, subscription and audit row keeps
-- its identity.
--
-- Classification:
--   * PERSONAL: per user, their oldest workspace where they are the owner and
--     the only member, with no pending invites. Renamed "Personal".
--   * SHARED: every other workspace (a team). Members and roles carry over
--     unchanged: owner -> OWNER, admins -> ADMIN, everyone else -> MEMBER.
--   * A user left without a personal Realm (they only belonged to teams, or
--     their own workspace was a team) gets a new, empty one.
-- Projects stay in the Realm they were in. Provider keys were per user, never
-- per team, so they move into their owner's personal Realm.
--
-- One transaction: Prisma runs migration statements without one, and a
-- half-applied rename would leave the database matching neither schema.

BEGIN;

-- ─── Enums ────────────────────────────────────────────────

ALTER TYPE "organization_role" RENAME TO "realm_role";
CREATE TYPE "realm_type" AS ENUM ('PERSONAL', 'SHARED');
CREATE TYPE "realm_invite_status" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- ─── realms (was organizations) ───────────────────────────

ALTER TABLE "organizations" RENAME TO "realms";
ALTER TABLE "realms" RENAME CONSTRAINT "organizations_pkey" TO "realms_pkey";
ALTER TABLE "realms" RENAME CONSTRAINT "organizations_owner_id_fkey" TO "realms_owner_id_fkey";
ALTER INDEX "organizations_owner_id_idx" RENAME TO "realms_owner_id_idx";
-- The slug was only ever generated, never read or shown.
ALTER TABLE "realms" DROP COLUMN "slug";
ALTER TABLE "realms" ADD COLUMN "type" "realm_type" NOT NULL DEFAULT 'SHARED',
ADD COLUMN "brief" TEXT NOT NULL DEFAULT '';

-- ─── realm_members (was organization_members) ─────────────

ALTER TABLE "organization_members" RENAME TO "realm_members";
ALTER TABLE "realm_members" RENAME COLUMN "organization_id" TO "realm_id";
ALTER TABLE "realm_members" RENAME CONSTRAINT "organization_members_pkey" TO "realm_members_pkey";
ALTER TABLE "realm_members" RENAME CONSTRAINT "organization_members_organization_id_fkey" TO "realm_members_realm_id_fkey";
ALTER TABLE "realm_members" RENAME CONSTRAINT "organization_members_user_id_fkey" TO "realm_members_user_id_fkey";
ALTER INDEX "organization_members_user_id_idx" RENAME TO "realm_members_user_id_idx";

-- ─── realm_invites (was organization_invites) ─────────────

ALTER TABLE "organization_invites" RENAME TO "realm_invites";
ALTER TABLE "realm_invites" RENAME COLUMN "organization_id" TO "realm_id";
ALTER TABLE "realm_invites" RENAME CONSTRAINT "organization_invites_pkey" TO "realm_invites_pkey";
ALTER TABLE "realm_invites" RENAME CONSTRAINT "organization_invites_organization_id_fkey" TO "realm_invites_realm_id_fkey";
ALTER TABLE "realm_invites" RENAME CONSTRAINT "organization_invites_invited_by_id_fkey" TO "realm_invites_invited_by_id_fkey";
ALTER INDEX "organization_invites_token_hash_key" RENAME TO "realm_invites_token_hash_key";
DROP INDEX "organization_invites_organization_id_idx";
DROP INDEX "organization_invites_token_hash_idx";
ALTER TABLE "realm_invites" ADD COLUMN "status" "realm_invite_status" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "realm_invites" SET "status" = CASE
  WHEN "accepted_at" IS NOT NULL THEN 'ACCEPTED'::"realm_invite_status"
  WHEN "revoked_at" IS NOT NULL THEN 'REVOKED'::"realm_invite_status"
  ELSE 'PENDING'::"realm_invite_status"
END, "updated_at" = COALESCE("accepted_at", "revoked_at", "created_at");
ALTER TABLE "realm_invites" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "realm_invites" DROP COLUMN "accepted_at", DROP COLUMN "revoked_at";
CREATE INDEX "realm_invites_realm_id_status_idx" ON "realm_invites"("realm_id", "status");

-- ─── organization_id -> realm_id everywhere else ──────────

ALTER TABLE "projects" RENAME COLUMN "organization_id" TO "realm_id";
ALTER TABLE "projects" RENAME CONSTRAINT "projects_organization_id_fkey" TO "projects_realm_id_fkey";
ALTER INDEX "projects_organization_id_idx" RENAME TO "projects_realm_id_idx";

ALTER TABLE "subscriptions" RENAME COLUMN "organization_id" TO "realm_id";
ALTER TABLE "subscriptions" RENAME CONSTRAINT "subscriptions_organization_id_fkey" TO "subscriptions_realm_id_fkey";
ALTER INDEX "subscriptions_organization_id_key" RENAME TO "subscriptions_realm_id_key";

ALTER TABLE "entitlements" RENAME COLUMN "organization_id" TO "realm_id";
ALTER TABLE "entitlements" RENAME CONSTRAINT "entitlements_organization_id_fkey" TO "entitlements_realm_id_fkey";
ALTER INDEX "entitlements_organization_id_idx" RENAME TO "entitlements_realm_id_idx";
ALTER INDEX "entitlements_organization_id_key_key" RENAME TO "entitlements_realm_id_key_key";

ALTER TABLE "background_jobs" RENAME COLUMN "organization_id" TO "realm_id";
ALTER TABLE "background_jobs" RENAME CONSTRAINT "background_jobs_organization_id_fkey" TO "background_jobs_realm_id_fkey";
ALTER INDEX "background_jobs_organization_id_idx" RENAME TO "background_jobs_realm_id_idx";

ALTER TABLE "audit_events" RENAME COLUMN "organization_id" TO "realm_id";
ALTER TABLE "audit_events" RENAME CONSTRAINT "audit_events_organization_id_fkey" TO "audit_events_realm_id_fkey";
ALTER INDEX "audit_events_organization_id_created_at_idx" RENAME TO "audit_events_realm_id_created_at_idx";
UPDATE "audit_events" SET
  "action" = regexp_replace("action", '^organization\.', 'realm.'),
  "target_type" = regexp_replace("target_type", '^organization', 'realm');

ALTER TABLE "usage_ledgers" RENAME COLUMN "organization_id" TO "realm_id";
ALTER TABLE "usage_ledgers" RENAME CONSTRAINT "usage_ledgers_organization_id_fkey" TO "usage_ledgers_realm_id_fkey";
ALTER INDEX "usage_ledgers_organization_id_occurred_at_idx" RENAME TO "usage_ledgers_realm_id_occurred_at_idx";

ALTER TABLE "github_installations" RENAME COLUMN "organization_id" TO "realm_id";
ALTER TABLE "github_installations" RENAME CONSTRAINT "github_installations_organization_id_fkey" TO "github_installations_realm_id_fkey";
ALTER INDEX "github_installations_organization_id_idx" RENAME TO "github_installations_realm_id_idx";

ALTER TABLE "platform_api_keys" RENAME COLUMN "organization_id" TO "realm_id";
ALTER TABLE "platform_api_keys" RENAME CONSTRAINT "platform_api_keys_organization_id_fkey" TO "platform_api_keys_realm_id_fkey";
ALTER INDEX "platform_api_keys_organization_id_idx" RENAME TO "platform_api_keys_realm_id_idx";

-- ─── Project collaborators fold into Realm membership ─────
-- Access to a project now comes from its Realm. Anyone who collaborated on a
-- project keeps access as a member of that project's Realm.

INSERT INTO "realm_members" ("realm_id", "user_id", "role", "created_at", "updated_at")
SELECT DISTINCT p."realm_id", c."user_id", 'MEMBER'::"realm_role", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "project_collaborators" c
JOIN "projects" p ON p."id" = c."project_id"
ON CONFLICT ("realm_id", "user_id") DO NOTHING;

DROP TABLE "project_collaborators";
DROP TYPE "project_role";

-- ─── Classify personal vs shared ──────────────────────────

UPDATE "realms" r SET "type" = 'PERSONAL', "name" = 'Personal'
FROM (
  SELECT DISTINCT ON (r2."owner_id") r2."id"
  FROM "realms" r2
  WHERE NOT EXISTS (
      SELECT 1 FROM "realm_members" m
      WHERE m."realm_id" = r2."id" AND m."user_id" <> r2."owner_id"
    )
    AND NOT EXISTS (
      SELECT 1 FROM "realm_invites" i
      WHERE i."realm_id" = r2."id" AND i."status" = 'PENDING' AND i."expires_at" > CURRENT_TIMESTAMP
    )
  ORDER BY r2."owner_id", r2."created_at", r2."id"
) personal
WHERE r."id" = personal."id";

-- The owner's membership row always says OWNER (exactly one owner per Realm).
UPDATE "realm_members" m SET "role" = 'OWNER'
FROM "realms" r
WHERE r."id" = m."realm_id" AND r."owner_id" = m."user_id" AND m."role" <> 'OWNER';
UPDATE "realm_members" m SET "role" = 'ADMIN'
FROM "realms" r
WHERE r."id" = m."realm_id" AND r."owner_id" <> m."user_id" AND m."role" = 'OWNER';

-- ─── A personal Realm for everyone who has none ───────────

CREATE TEMP TABLE "new_personal_realms" ON COMMIT DROP AS
SELECT gen_random_uuid()::text AS "id", u."id" AS "user_id"
FROM "users" u
WHERE NOT EXISTS (
  SELECT 1 FROM "realms" r WHERE r."owner_id" = u."id" AND r."type" = 'PERSONAL'
);

INSERT INTO "realms" ("id", "name", "type", "brief", "owner_id", "created_at", "updated_at")
SELECT "id", 'Personal', 'PERSONAL', '', "user_id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "new_personal_realms";

INSERT INTO "realm_members" ("realm_id", "user_id", "role", "created_at", "updated_at")
SELECT "id", "user_id", 'OWNER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "new_personal_realms";

-- ─── Provider keys belong to a Realm ──────────────────────

ALTER TABLE "api_keys" ADD COLUMN "realm_id" TEXT;
UPDATE "api_keys" k SET "realm_id" = r."id"
FROM "realms" r WHERE r."owner_id" = k."user_id" AND r."type" = 'PERSONAL';
ALTER TABLE "api_keys" ALTER COLUMN "realm_id" SET NOT NULL;
DROP INDEX "api_keys_user_id_provider_label_key";
CREATE UNIQUE INDEX "api_keys_realm_id_provider_label_key" ON "api_keys"("realm_id", "provider", "label");
CREATE INDEX "api_keys_user_id_idx" ON "api_keys"("user_id");
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "image_provider_configs" ADD COLUMN "realm_id" TEXT;
UPDATE "image_provider_configs" k SET "realm_id" = r."id"
FROM "realms" r WHERE r."owner_id" = k."user_id" AND r."type" = 'PERSONAL';
ALTER TABLE "image_provider_configs" ALTER COLUMN "realm_id" SET NOT NULL;
DROP INDEX "image_provider_configs_user_id_label_key";
CREATE UNIQUE INDEX "image_provider_configs_realm_id_label_key" ON "image_provider_configs"("realm_id", "label");
ALTER TABLE "image_provider_configs" ADD CONSTRAINT "image_provider_configs_realm_id_fkey" FOREIGN KEY ("realm_id") REFERENCES "realms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
