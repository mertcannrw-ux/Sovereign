import fs from 'node:fs';
import path from 'node:path';

const dtsPath = path.join(process.env.TEMP, 'lucide-react-0.487.0/package/dist/lucide-react.d.ts');
const text = fs.readFileSync(dtsPath, 'utf8');
const exportStart = text.lastIndexOf('export {');
if (exportStart < 0) throw new Error('no export block');
const exportBlock = text.slice(exportStart);

const canonical = new Set();
const aliases = new Map();

for (const part of exportBlock.replace(/^export \{/, '').replace(/};?\s*$/, '').split(',')) {
  const token = part.trim();
  if (!token) continue;
  const asMatch = token.match(/^(\w+)\s+as\s+(\w+)$/);
  if (asMatch) {
    const from = asMatch[1];
    const to = asMatch[2];
    canonical.add(from);
    if (from !== to) aliases.set(to, from);
    continue;
  }
  const ident = token.match(/^(\w+)$/);
  if (ident) canonical.add(ident[1]);
}

const outDir = path.join(import.meta.dirname, '..', 'src');
const payload = {
  exports: [...canonical].sort(),
  aliases: Object.fromEntries(
    [...aliases.entries()].filter(([alias, from]) => alias !== `${from}Icon`).sort(([a], [b]) => a.localeCompare(b)),
  ),
};
fs.writeFileSync(path.join(outDir, 'lucide-0.487-exports.json'), `${JSON.stringify(payload)}\n`);
console.log('canonical', canonical.size, 'renamedAliases', Object.keys(payload.aliases).length);
