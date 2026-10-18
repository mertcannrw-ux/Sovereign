/**
 * `npm run db:migrate -- <name>`: write a migration for the changes in
 * schema.prisma and apply it to the local database.
 *
 * `prisma migrate dev` needs a shadow database, which the single-database
 * PGlite server cannot provide. Instead this brings the local database up to
 * the committed migrations, diffs it against schema.prisma, and saves that
 * diff as the next migration. Review the SQL before committing it.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const name = process.argv[2];
if (!name || !/^[a-z0-9_]+$/.test(name)) {
  console.error('Usage: npm run db:migrate -- <name>   (lowercase letters, digits, underscores)');
  process.exit(1);
}

const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const prisma = (args, options = {}) =>
  execFileSync(process.execPath, [prismaCli, ...args], { encoding: 'utf8', ...options });

prisma(['migrate', 'deploy'], { stdio: 'inherit' });

const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const dir = join('prisma', 'migrations', `${stamp}_${name}`);
const file = join(dir, 'migration.sql');
mkdirSync(dir, { recursive: true });
// --output, not stdout: prisma.config.ts's dotenv banner also goes to stdout.
prisma([
  'migrate',
  'diff',
  '--from-config-datasource',
  '--to-schema',
  'prisma/schema.prisma',
  '--script',
  '--output',
  file,
]);
if (!/^\s*[A-Z]/m.test(readFileSync(file, 'utf8').replace(/^--.*$/gm, ''))) {
  rmSync(dir, { recursive: true });
  console.log('schema.prisma matches the migrations; nothing to do.');
  process.exit(0);
}
console.log(`Wrote ${file}`);

prisma(['migrate', 'deploy'], { stdio: 'inherit' });
