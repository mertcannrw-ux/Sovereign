import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { Prisma } from '@prisma-generated/prisma/client';
import { protectedProcedure, router } from '../trpc';
import { requireProjectRole } from '@/server/authz';
import { checkRateLimit } from '@/server/rate-limit';
import { isSafeDefault, sanitizeSqlForTenant } from '@/server/db-browser';

/**
 * Schema for a single column definition.
 */
const columnSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(
      /^[a-z][a-z0-9_]*$/,
      'Column name must start with a lowercase letter and contain only lowercase letters, digits, and underscores',
    ),
  type: z.enum([
    'TEXT',
    'VARCHAR(255)',
    'INTEGER',
    'BIGINT',
    'BOOLEAN',
    'TIMESTAMP',
    'DATE',
    'FLOAT',
    'JSONB',
    'UUID',
  ]),
  nullable: z.boolean().default(true),
  unique: z.boolean().default(false),
  defaultValue: z.string().nullable().default(null),
});

export type ColumnDef = z.infer<typeof columnSchema>;

export const databaseRouter = router({
  /**
   * List all tables in the project's database schema.
   */
  listTables: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectRole(ctx, input.projectId, 'VIEWER');

      const appDb = await ctx.db.appDatabase.findFirst({ where: { projectId: input.projectId } });

      if (!appDb) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No database configured for this project',
        });
      }

      const tables = await ctx.db.$queryRawUnsafe<
        { tablename: string; tableowner: string; tablespace: string | null }[]
      >(
        `SELECT tablename, tableowner, tablespace
         FROM pg_tables
         WHERE schemaname = $1
         ORDER BY tablename`,
        appDb.schemaName,
      );

      return tables;
    }),

  /**
   * Get the schema of a specific table — columns, types, constraints.
   */
  getTableSchema: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        tableName: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Invalid table name format'),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectRole(ctx, input.projectId, 'VIEWER');

      const appDb = await ctx.db.appDatabase.findFirst({ where: { projectId: input.projectId } });

      if (!appDb) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No database configured for this project',
        });
      }

      const columns = await ctx.db.$queryRawUnsafe<
        {
          column_name: string;
          data_type: string;
          is_nullable: string;
          column_default: string | null;
          character_maximum_length: number | null;
        }[]
      >(
        `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        appDb.schemaName,
        input.tableName,
      );

      const constraints = await ctx.db.$queryRawUnsafe<
        {
          constraint_name: string;
          constraint_type: string;
          column_name: string;
        }[]
      >(
        `SELECT tc.constraint_name, tc.constraint_type, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
           AND tc.table_schema = kcu.table_schema
         WHERE tc.table_schema = $1 AND tc.table_name = $2
         ORDER BY tc.constraint_name`,
        appDb.schemaName,
        input.tableName,
      );

      return { columns, constraints };
    }),

  /**
   * Create a new table in the project's database schema.
   */
  createTable: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        tableName: z
          .string()
          .min(1)
          .max(63)
          .regex(
            /^[a-z][a-z0-9_]*$/,
            'Table name must start with a letter and contain only lowercase letters, numbers, and underscores',
          ),
        columns: z.array(columnSchema).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectRole(ctx, input.projectId, 'EDITOR');

      const appDb = await ctx.db.appDatabase.findFirst({ where: { projectId: input.projectId } });

      if (!appDb) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No database configured for this project',
        });
      }

      const columnDefs = input.columns
        .map((col) => {
          const parts = [`"${col.name}"`, col.type];
          if (!col.nullable) parts.push('NOT NULL');
          if (col.unique) parts.push('UNIQUE');
          if (col.defaultValue !== null) {
            if (!isSafeDefault(col.defaultValue)) {
              throw new TRPCError({
                code: 'BAD_REQUEST',
                message: `Unsupported default value for column "${col.name}"`,
              });
            }
            parts.push(`DEFAULT ${col.defaultValue}`);
          }
          return parts.join(' ');
        })
        .join(', ');

      const sql = `CREATE TABLE "${appDb.schemaName}"."${input.tableName}" (${columnDefs})`;

      try {
        await ctx.db.$executeRawUnsafe(sql);
        return { success: true, tableName: input.tableName };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create table';
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),

  /**
   * Drop a table from the project's database schema.
   */
  deleteTable: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        tableName: z.string().regex(/^[a-z][a-z0-9_]*$/, 'Invalid table name format'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectRole(ctx, input.projectId, 'EDITOR');

      const appDb = await ctx.db.appDatabase.findFirst({ where: { projectId: input.projectId } });

      if (!appDb) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No database configured for this project',
        });
      }

      const sql = `DROP TABLE IF EXISTS "${appDb.schemaName}"."${input.tableName}"`;

      try {
        await ctx.db.$executeRawUnsafe(sql);
        return { success: true, tableName: input.tableName };
      } catch (err) {
        console.error('Failed to delete table:', err);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete table. Ensure table exists and has no dependent objects.',
        });
      }
    }),

  /**
   * Execute a read-only SQL query against the project's database schema.
   */
  executeQuery: protectedProcedure
    .input(z.object({ projectId: z.string(), sql: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireProjectRole(ctx, input.projectId, 'VIEWER');

      const rate = await checkRateLimit('dbQuery', ctx.user.id);
      if (!rate.allowed) {
        const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Query rate limit exceeded. Try again in ${retryIn}s.`,
        });
      }

      const appDb = await ctx.db.appDatabase.findFirst({ where: { projectId: input.projectId } });

      if (!appDb) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No database configured for this project',
        });
      }

      const statement = sanitizeSqlForTenant(input.sql, appDb.schemaName);
      if (!statement) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only single SELECT/WITH statements are allowed — platform schemas, system catalogs, other tenant schemas, and multi-statement queries are blocked',
        });
      }

      // Read-only transaction pinned to the tenant schema on one connection, so
      // search_path can never leak to another tenant through the pool.
      try {
        const rows = await ctx.db.$transaction(async (tx) => {
          await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
          await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '10s'`);
          await tx.$executeRaw(
            Prisma.sql`SET LOCAL search_path TO ${Prisma.raw('"' + appDb.schemaName.replaceAll('"', '""') + '"')}`,
          );
          return tx.$queryRawUnsafe<Record<string, unknown>[]>(
            `SELECT * FROM (${statement}) AS _q LIMIT 501`,
          );
        });
        return { rows: rows.slice(0, 500), rowCount: rows.length };
      } catch (err) {
        console.error('Failed to execute query:', err);
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Query execution failed. Please verify your SQL syntax and table references.',
        });
      }
    }),
});
