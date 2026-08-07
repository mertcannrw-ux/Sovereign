/**
 * Structured database browser — replaces arbitrary SQL execution.
 * All queries are parameterized with strict identifier validation.
 */

import { Prisma } from '@prisma-generated/prisma/client';
import type { PrismaClient } from '@prisma-generated/prisma/client';
import { z } from 'zod';

// ─── Validation schemas ───────────────────────────────────

const IDENTIFIER_REGEX = /^[a-z][a-z0-9_]*$/;
const MAX_IDENTIFIER_LENGTH = 63;
const MAX_ROWS = 100;

const identifierSchema = z
  .string()
  .min(1)
  .max(MAX_IDENTIFIER_LENGTH)
  .regex(
    IDENTIFIER_REGEX,
    'Invalid identifier: must start with a lowercase letter and contain only lowercase letters, digits, and underscores',
  );

const sortDirectionSchema = z.enum(['asc', 'desc']);

const filterSchema = z.object({
  column: identifierSchema,
  operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in', 'is_null']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]).optional(),
});

// ─── Public API ───────────────────────────────────────────

export interface BrowseResult {
  rows: Record<string, unknown>[];
  columns: string[];
  totalEstimate?: number;
  cursor?: string;
}

export interface TableSchema {
  tableName: string;
  columns: ColumnInfo[];
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  isPrimaryKey: boolean;
}

/**
 * List all user tables in a project's schema.
 */
export async function listTables(db: PrismaClient, schemaName: string): Promise<string[]> {
  const validatedSchema = identifierSchema.parse(schemaName);

  const result = await db.$queryRaw<{ tablename: string }[]>(
    Prisma.sql`SELECT tablename FROM pg_tables WHERE schemaname = ${validatedSchema} ORDER BY tablename`,
  );

  return result.map((r) => r.tablename);
}

/**
 * Get the schema of a specific table.
 */
export async function getTableSchema(
  db: PrismaClient,
  schemaName: string,
  tableName: string,
): Promise<TableSchema> {
  const validatedSchema = identifierSchema.parse(schemaName);
  const validatedTable = identifierSchema.parse(tableName);

  const columns = await db.$queryRaw<ColumnInfo[]>(
    Prisma.sql`
      SELECT
        c.column_name as "name",
        c.data_type as "type",
        c.is_nullable = 'YES' as "nullable",
        c.column_default as "defaultValue",
        (SELECT EXISTS (
          SELECT 1 FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
          WHERE tc.table_schema = ${validatedSchema}
            AND tc.table_name = ${validatedTable}
            AND tc.constraint_type = 'PRIMARY KEY'
            AND kcu.column_name = c.column_name
        )) as "isPrimaryKey"
      FROM information_schema.columns c
      WHERE c.table_schema = ${validatedSchema} AND c.table_name = ${validatedTable}
      ORDER BY c.ordinal_position
    `,
  );

  return { tableName: validatedTable, columns };
}

/**
 * Browse rows with filtering, sorting, and cursor pagination.
 */
export async function browseRows(
  db: PrismaClient,
  schemaName: string,
  tableName: string,
  options: {
    columns?: string[];
    filters?: z.infer<typeof filterSchema>[];
    sort?: { column: string; direction: 'asc' | 'desc' }[];
    cursor?: string;
    limit?: number;
  } = {},
): Promise<BrowseResult> {
  const validatedSchema = identifierSchema.parse(schemaName);
  const validatedTable = identifierSchema.parse(tableName);
  const limit = Math.min(options.limit ?? MAX_ROWS, MAX_ROWS);

  // Validate column names
  const selectedColumns = options.columns?.map((c) => identifierSchema.parse(c)) ?? ['*'];
  const columnClause = selectedColumns.join(', ');

  // Build WHERE clause using Prisma.Sql fragments
  const conditions: Prisma.Sql[] = [];

  for (const filter of options.filters ?? []) {
    const col = identifierSchema.parse(filter.column);

    switch (filter.operator) {
      case 'eq':
        conditions.push(Prisma.sql`${Prisma.raw(col)} = ${filter.value}`);
        break;
      case 'neq':
        conditions.push(Prisma.sql`${Prisma.raw(col)} != ${filter.value}`);
        break;
      case 'gt':
        conditions.push(Prisma.sql`${Prisma.raw(col)} > ${filter.value}`);
        break;
      case 'gte':
        conditions.push(Prisma.sql`${Prisma.raw(col)} >= ${filter.value}`);
        break;
      case 'lt':
        conditions.push(Prisma.sql`${Prisma.raw(col)} < ${filter.value}`);
        break;
      case 'lte':
        conditions.push(Prisma.sql`${Prisma.raw(col)} <= ${filter.value}`);
        break;
      case 'like':
        conditions.push(Prisma.sql`${Prisma.raw(col)} LIKE ${filter.value}`);
        break;
      case 'ilike':
        conditions.push(Prisma.sql`${Prisma.raw(col)} ILIKE ${filter.value}`);
        break;
      case 'in':
        conditions.push(Prisma.sql`${Prisma.raw(col)} = ANY(${filter.value})`);
        break;
      case 'is_null':
        conditions.push(Prisma.sql`${Prisma.raw(col)} IS NULL`);
        break;
    }
  }

  const whereFragment =
    conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;

  // Build ORDER BY clause
  const orderFragments = (options.sort ?? []).map((s) => {
    const col = identifierSchema.parse(s.column);
    const dir = sortDirectionSchema.parse(s.direction);
    return Prisma.sql`${Prisma.raw(col)} ${Prisma.raw(dir)}`;
  });

  const orderFragment =
    orderFragments.length > 0
      ? Prisma.sql`ORDER BY ${Prisma.join(orderFragments, ', ')}`
      : Prisma.empty;

  // Cursor-based pagination
  const cursorFragment = options.cursor ? Prisma.sql`AND id > ${options.cursor}` : Prisma.empty;

  // Execute in a transaction for SET LOCAL isolation
  const rows = await db.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL search_path TO ${Prisma.raw(validatedSchema)}`);

    return tx.$queryRaw<Record<string, unknown>[]>(
      Prisma.sql`
        SELECT ${Prisma.raw(columnClause)} FROM ${Prisma.raw(validatedTable)}
        ${whereFragment} ${cursorFragment}
        ${orderFragment}
        LIMIT ${limit + 1}
      `,
    );
  });

  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && resultRows.length > 0
      ? String(resultRows[resultRows.length - 1]?.id ?? '')
      : undefined;

  return {
    rows: resultRows,
    columns: selectedColumns,
    cursor: nextCursor,
  };
}
