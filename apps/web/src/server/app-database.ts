import { quotePgIdent } from '@/server/db-browser';

type AppDatabaseRecord = { id: string; projectId: string; schemaName: string };

type Db = {
  appDatabase: {
    findFirst: (args: { where: { projectId: string } }) => Promise<AppDatabaseRecord | null>;
    create: (args: {
      data: { projectId: string; schemaName: string };
    }) => Promise<AppDatabaseRecord>;
  };
  $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown>;
};

const TENANT_SCHEMA_RE = /^p_[a-f0-9]{32}$/;

export function schemaNameForProject(projectId: string): string {
  const compact = projectId.replaceAll('-', '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(compact)) {
    throw new Error('Invalid project id');
  }
  return `p_${compact}`;
}

export function assertTenantSchemaName(schemaName: string): string {
  if (!TENANT_SCHEMA_RE.test(schemaName)) {
    throw new Error('Invalid tenant schema name');
  }
  return schemaName;
}

export async function provisionAppDatabase(db: Db, projectId: string) {
  const existing = await db.appDatabase.findFirst({ where: { projectId } });
  if (existing) {
    assertTenantSchemaName(existing.schemaName);
    return existing;
  }

  const schemaName = schemaNameForProject(projectId);
  await db.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${quotePgIdent(schemaName)}`);
  return db.appDatabase.create({
    data: { projectId, schemaName },
  });
}

export async function requireAppDatabase(db: Db, projectId: string) {
  return provisionAppDatabase(db, projectId);
}
