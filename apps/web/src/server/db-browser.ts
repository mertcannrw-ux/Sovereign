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

export function quotePgIdent(ident: string): string {
  const parsed = identifierSchema.safeParse(ident);
  if (!parsed.success) {
    throw new Error('Invalid SQL identifier');
  }
  return `"${ident.replaceAll('"', '""')}"`;
}

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
 * Strip string literals and comments from SQL so the remaining text can be
 * inspected for dangerous tokens. Quotes and comments are replaced with spaces
 * to preserve token boundaries.
 */
export function stripSqlLiterals(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'") {
          i += sql[i + 1] === "'" ? 2 : 1;
          break;
        }
        i += 1;
      }
      out += ' ';
    } else if (ch === '"') {
      // Double quotes denote IDENTIFIERS in SQL, not string literals.
      // Preserve them so schema-qualified references like "public"."api_keys"
      // survive stripping and can be caught by the pattern checks below.
      out += ch;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === '"') {
          out += '"';
          i += sql[i + 1] === '"' ? 2 : 1;
          break;
        }
        out += sql[i];
        i += 1;
      }
    } else if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      out += ' ';
    } else if (ch === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i += 1;
      i = Math.min(i + 2, sql.length);
      out += ' ';
    } else if (ch === '$' && /[0-9A-Za-z_]/.test(next ?? '')) {
      const tag = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        i = end >= 0 ? end + tag.length : sql.length;
        out += ' ';
        continue;
      }
      out += ch;
      i += 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

const PLATFORM_REFERENCE_PATTERNS = [
  /(^|[^A-Za-z0-9_])public(\.|\b)/i,
  /(^|[^A-Za-z0-9_])pg_[A-Za-z0-9_]+/i,
  /(^|[^A-Za-z0-9_])information_schema/i,
  /(^|[^A-Za-z0-9_])pg_catalog/i,
  /(^|[^A-Za-z0-9_])pg_toast/i,
];

const FORBIDDEN_SQL_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'ALTER',
  'TRUNCATE',
  'GRANT',
  'REVOKE',
  'COPY',
  'CREATE',
  'EXEC',
  'EXECUTE',
  'INTO',
  'SET_CONFIG',
  'CURRENT_SETTING',
];

// Functions that reach outside the tenant schema (filesystem, sockets, server
// process control, locks, notifications). Now that string literals are allowed,
// these would otherwise become reachable — e.g. pg_read_file('...').
const FORBIDDEN_FUNCTIONS = [
  'pg_read_file',
  'pg_read_binary_file',
  'pg_ls_dir',
  'pg_stat_file',
  'pg_current_logfile',
  'pg_write_file',
  'pg_execute_server_program',
  'pg_sleep',
  'pg_terminate_backend',
  'pg_cancel_backend',
  'pg_notify',
  'lo_import',
  'lo_export',
  'dblink',
  'pg_relation_filepath',
  'pg_reload_conf',
  'pg_rotate_logfile',
  'pg_start_backup',
  'pg_stop_backup',
  'pg_create_restore_point',
  'set_config',
  'current_setting',
];

/**
 * Detect schema-qualified table references in FROM/JOIN clauses that point to a
 * schema other than the tenant's own. Unqualified names are safe (they resolve
 * via search_path); `tenantSchema.` prefixes are allowed as self-qualification.
 * Column references like `alias.column` in SELECT/WHERE are not table
 * references and are deliberately left untouched. Returns true on a foreign
 * schema reference.
 */
function referencesForeignSchema(stripped: string, tenantSchema?: string): boolean {
  // Match the table list following FROM/JOIN. The capture group allows
  // parentheses so parenthesized subqueries and CTEs are scanned, not just
  // flat table lists. Parenthesized captures are pushed onto a stack and
  // re-scanned for their own FROM/JOIN references.
  const clauseRe =
    /\b(FROM|JOIN)\s+([\s\S]*?)(?=\s+(?:WHERE|GROUP\s+BY|ORDER\s+BY|HAVING|LIMIT|OFFSET|UNION|INTERSECT|EXCEPT|JOIN)\b|$)/gi;
  const stack: string[] = [stripped];
  while (stack.length > 0) {
    const source = stack.pop()!;
    clauseRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = clauseRe.exec(source)) !== null) {
      const tableList = m[2];
      if (!tableList) continue;
      // Split on commas that are NOT inside parentheses (subquery column lists).
      for (const part of tableList.split(',')) {
        // Accept optional double quotes around each identifier segment so
        // "schema"."table" references are caught as well as schema.table.
        const q = /^\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\.\s*"?([A-Za-z_][A-Za-z0-9_]*)"?\b/.exec(
          part,
        );
        if (!q) {
          // Parenthesized subquery or CTE: scan inside for its own FROM/JOIN
          // references instead of giving up on the leading parenthesis.
          if (part.includes('(')) stack.push(part);
          continue;
        }
        const schema = q[1]!.toLowerCase();
        if (!tenantSchema || schema !== tenantSchema.toLowerCase()) return true;
      }
    }
  }
  return false;
}

/**
 * Prepare a user-supplied statement for execution against a tenant schema.
 * Returns null when the statement could touch the platform schema, system
 * catalogs, another tenant's schema, or anything other than a single read-only
 * SELECT/WITH statement.
 */
export function sanitizeSqlForTenant(sql: string, tenantSchema?: string): string | null {
  const raw = sql.trim();
  // Inspect the structural SQL with string literals, dollar-quoted bodies, and
  // comments removed, so legitimate quoted values are allowed.
  const stripped = stripSqlLiterals(raw).trim();
  if (!/^(SELECT|WITH)\s/i.test(stripped)) return null;
  // A single statement must not contain an internal statement terminator. A
  // trailing semicolon is not a terminator — it ends the same statement, so
  // strip it before checking rather than rejecting `SELECT 1;`.
  const withoutTrailingTerminator = stripped.replace(/;+\s*$/, '');
  if (/;/.test(withoutTrailingTerminator)) return null;

  const upper = withoutTrailingTerminator.toUpperCase();
  for (const kw of FORBIDDEN_SQL_KEYWORDS) {
    const regex = new RegExp(`(?:^|[^A-Z0-9_])${kw}(?:$|[^A-Z0-9_])`);
    if (regex.test(upper)) return null;
  }

  for (const pattern of PLATFORM_REFERENCE_PATTERNS) {
    if (pattern.test(withoutTrailingTerminator)) return null;
  }

  for (const fn of FORBIDDEN_FUNCTIONS) {
    const regex = new RegExp(`(^|[^A-Za-z0-9_])${fn}\\s*\\(`, 'i');
    if (regex.test(withoutTrailingTerminator)) return null;
  }

  if (referencesForeignSchema(withoutTrailingTerminator, tenantSchema)) return null;

  return raw.replace(/;+\s*$/, '');
}

/**
 * Column DEFAULT expressions are restricted to a small allowlist so they can
 * never smuggle SQL into CREATE TABLE.
 */
const SAFE_DEFAULT_PATTERN =
  /^(NULL|true|false|now\(\)|CURRENT_TIMESTAMP|CURRENT_DATE|CURRENT_TIME|[-+]?[0-9]+(\.[0-9]+)?|'[A-Za-z0-9 _@./:+-]*')$/i;

export function isSafeDefault(value: string): boolean {
  return SAFE_DEFAULT_PATTERN.test(value);
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

  // '*' is the only special column clause; any explicit column must be a valid identifier.
  const selectedColumns =
    options.columns == null ? ['*'] : options.columns.map((c) => identifierSchema.parse(c));
  if (selectedColumns.includes('*') && selectedColumns.length > 1) {
    throw new Error('Cannot mix "*" with explicit column names');
  }
  const columnClause = selectedColumns.join(', ');

  // Resolve the cursor column: explicit sort key if present, otherwise the
  // caller's filter set is unordered and cursor pagination would be unstable.
  // Fall back to 'id' only when no sort is specified (preserves existing API
  // contract) but require the caller to opt in via sort for ordered pagination.
  const cursorOrderColumn =
    options.sort && options.sort.length > 0
      ? identifierSchema.parse(options.sort[0]!.column)
      : 'id';

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

  // Cursor-based pagination — bound to the first ORDER BY column (or id when
  // no sort is specified) so pagination advances in the same order as the
  // result set. Previously the cursor used a hardcoded `id` column and was
  // pushed after whereFragment, so it never appeared in the query.
  if (options.cursor) {
    conditions.push(Prisma.sql`${Prisma.raw(cursorOrderColumn)} > ${options.cursor}`);
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

  // Execute in a transaction for SET LOCAL isolation
  const rows = await db.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SET LOCAL search_path TO ${Prisma.raw(validatedSchema)}`);

    return tx.$queryRaw<Record<string, unknown>[]>(
      Prisma.sql`
        SELECT ${Prisma.raw(columnClause)} FROM ${Prisma.raw(validatedTable)}
        ${whereFragment}
        ${orderFragment}
        LIMIT ${limit + 1}
      `,
    );
  });

  const hasMore = rows.length > limit;
  const resultRows = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && resultRows.length > 0
      ? String(
          (resultRows[resultRows.length - 1] as Record<string, unknown>)[cursorOrderColumn] ?? '',
        )
      : undefined;

  return {
    rows: resultRows,
    columns: selectedColumns,
    cursor: nextCursor,
  };
}
