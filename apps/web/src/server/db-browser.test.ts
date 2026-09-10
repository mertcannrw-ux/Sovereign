// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { stripSqlLiterals, sanitizeSqlForTenant, quotePgIdent } from '@/server/db-browser';

describe('stripSqlLiterals', () => {
  it('strips single-quoted string literals', () => {
    const result = stripSqlLiterals("SELECT 'hello' FROM users");
    expect(result).not.toContain('hello');
    expect(result).toContain('FROM users');
  });

  it('preserves double-quoted identifiers', () => {
    const result = stripSqlLiterals('SELECT "my_col" FROM "users"');
    expect(result).toContain('"my_col"');
    expect(result).toContain('"users"');
  });

  it('strips line comments', () => {
    const result = stripSqlLiterals('SELECT 1 -- comment\nFROM t');
    expect(result).not.toContain('comment');
    expect(result).toContain('FROM t');
  });

  it('strips block comments', () => {
    const result = stripSqlLiterals('SELECT 1 /* block */ FROM t');
    expect(result).not.toContain('block');
    expect(result).toContain('FROM t');
  });
});

describe('sanitizeSqlForTenant', () => {
  it('blocks quoted platform schema references (P0 bypass)', () => {
    expect(sanitizeSqlForTenant('SELECT * FROM "public"."api_keys"', 'tenant_123')).toBeNull();
  });

  it('blocks quoted pg_catalog references', () => {
    expect(sanitizeSqlForTenant('SELECT * FROM "pg_catalog".pg_tables', 'tenant_123')).toBeNull();
  });

  it('blocks unquoted public schema references', () => {
    expect(sanitizeSqlForTenant('SELECT * FROM public.users', 'tenant_123')).toBeNull();
  });

  it('allows unqualified table references', () => {
    const sql = 'SELECT * FROM users';
    expect(sanitizeSqlForTenant(sql, 'tenant_123')).toBe(sql);
  });

  it('allows tenant self-qualified references', () => {
    const sql = 'SELECT * FROM tenant_123.users';
    expect(sanitizeSqlForTenant(sql, 'tenant_123')).toBe(sql);
  });

  it('blocks foreign-schema references in parenthesized subqueries (P3)', () => {
    expect(
      sanitizeSqlForTenant('SELECT * FROM (SELECT * FROM public.api_keys) t', 'tenant_123'),
    ).toBeNull();
  });

  it('blocks foreign-schema references in JOIN subqueries', () => {
    expect(
      sanitizeSqlForTenant(
        'SELECT * FROM users JOIN (SELECT * FROM other_schema.secrets) s ON true',
        'tenant_123',
      ),
    ).toBeNull();
  });

  it('allows quoted string literals in WHERE clauses', () => {
    const sql = "SELECT * FROM users WHERE name = 'John'";
    expect(sanitizeSqlForTenant(sql, 'tenant_123')).toBe(sql);
  });

  it('rejects non-SELECT statements', () => {
    expect(sanitizeSqlForTenant('DROP TABLE users', 'tenant_123')).toBeNull();
  });

  it('rejects multi-statement queries', () => {
    expect(sanitizeSqlForTenant('SELECT * FROM users; DROP TABLE users', 'tenant_123')).toBeNull();
  });

  it('allows WITH (CTE) statements', () => {
    const sql = 'WITH cte AS (SELECT * FROM users) SELECT * FROM cte';
    expect(sanitizeSqlForTenant(sql, 'tenant_123')).toBe(sql);
  });
});

describe('quotePgIdent', () => {
  it('quotes a safe identifier', () => {
    expect(quotePgIdent('p_abc123')).toBe('"p_abc123"');
  });

  it('rejects unsafe identifiers', () => {
    expect(() => quotePgIdent('public"; drop table users; --')).toThrow('Invalid SQL identifier');
    expect(() => quotePgIdent('Public')).toThrow('Invalid SQL identifier');
  });
});
