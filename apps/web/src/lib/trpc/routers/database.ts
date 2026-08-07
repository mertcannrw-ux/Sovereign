import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../trpc';

/**
 * Schema for a single column definition.
 */
const columnSchema = z.object({
  name: z.string().min(1).max(63),
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
      const project = await ctx.db.project.findUnique({
        where: { id: input.projectId },
        include: { collaborators: { where: { userId: ctx.user.id } } },
      });

      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      const isOwner = project.ownerId === ctx.user.id;
      const isCollab = project.collaborators.length > 0;
      if (!isOwner && !isCollab) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }

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
    .input(z.object({ projectId: z.string(), tableName: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.project.findUnique({
        where: { id: input.projectId },
        include: { collaborators: { where: { userId: ctx.user.id } } },
      });

      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      const isOwner = project.ownerId === ctx.user.id;
      const isCollab = project.collaborators.length > 0;
      if (!isOwner && !isCollab) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }

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
      const project = await ctx.db.project.findUnique({
        where: { id: input.projectId },
        include: { collaborators: { where: { userId: ctx.user.id } } },
      });

      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      const isOwner = project.ownerId === ctx.user.id;
      const isCollab = project.collaborators.length > 0;
      if (!isOwner && !isCollab) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }

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
    .input(z.object({ projectId: z.string(), tableName: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.db.project.findUnique({
        where: { id: input.projectId },
        include: { collaborators: { where: { userId: ctx.user.id } } },
      });

      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      const isOwner = project.ownerId === ctx.user.id;
      const isCollab = project.collaborators.length > 0;
      if (!isOwner && !isCollab) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      const appDb = await ctx.db.appDatabase.findFirst({ where: { projectId: input.projectId } });

      if (!appDb) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No database configured for this project',
        });
      }

      const sql = `DROP TABLE IF EXISTS "${appDb.schemaName}"."${input.tableName}" CASCADE`;

      try {
        await ctx.db.$executeRawUnsafe(sql);
        return { success: true, tableName: input.tableName };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to delete table';
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),

  /**
   * Execute a read-only SQL query against the project's database schema.
   */
  executeQuery: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        sql: z.string().min(1),
      }),
    )
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.project.findUnique({
        where: { id: input.projectId },
        include: { collaborators: { where: { userId: ctx.user.id } } },
      });

      if (!project) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
      }

      const isOwner = project.ownerId === ctx.user.id;
      const isCollab = project.collaborators.length > 0;
      if (!isOwner && !isCollab) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Access denied' });
      }

      const appDb = await ctx.db.appDatabase.findFirst({ where: { projectId: input.projectId } });

      if (!appDb) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No database configured for this project',
        });
      }

      // Only allow SELECT/WITH queries for safety
      const trimmed = input.sql.trim().toUpperCase();
      if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only SELECT and WITH (read-only) queries are allowed',
        });
      }

      // Set the search path to the project's schema first, then public
      await ctx.db.$executeRawUnsafe(`SET search_path TO "${appDb.schemaName}", public`);

      try {
        const rows = await ctx.db.$queryRawUnsafe<Record<string, unknown>[]>(input.sql);
        return { rows, rowCount: rows.length };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Query execution failed';
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
      }
    }),
});
