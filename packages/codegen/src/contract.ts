import { completePackageJson } from './dependency-complete';
import { repairJson, stringifyJson } from './json-repair';
import { fileImportsLucide, rewriteLucideSource } from './lucide-map';
import { replacePreviewAssetUrls } from './preview-assets';
import {
  isForbiddenEnvPath,
  REQUIRED_FILE_PATHS,
  sanitizeEnvExample,
  SEED_INDEX_HTML,
  SEED_VITE_CONFIG,
  SEEDS,
} from './stack-seeds';
import stackLock from './stack-lock.json';

export type StackFileOperation = 'create' | 'update' | 'delete';

export interface StackContractChange {
  path: string;
  operation: StackFileOperation;
  content?: string;
  before?: string;
}

export interface StackContractResult {
  files: Map<string, string>;
  changes: StackContractChange[];
  seeded: string[];
  repaired: string[];
  syntheticToolResult: string | null;
}

export interface ApplyStackContractOptions {
  assetUrlReplacements?: ReadonlyMap<string, string>;
}

const SOURCE_FILE_RE = /\.(?:[cm]?[jt]sx?)$/i;
const VISUAL_EDITOR_RE = /@app-builder\/visual-editor/;

function isBlank(content: string | undefined): boolean {
  return content === undefined || content.trim() === '';
}

function diffMaps(before: Map<string, string>, after: Map<string, string>): StackContractChange[] {
  const changes: StackContractChange[] = [];
  for (const [path, content] of after) {
    const previous = before.get(path);
    if (previous === undefined) {
      changes.push({ path, operation: 'create', content });
    } else if (previous !== content) {
      changes.push({ path, operation: 'update', content, before: previous });
    }
  }
  for (const [path, previous] of before) {
    if (!after.has(path)) {
      changes.push({ path, operation: 'delete', before: previous });
    }
  }
  return changes;
}

function ensureIndexHtml(content: string): string {
  if (!/<html\b/i.test(content)) return SEED_INDEX_HTML;
  let html = content;
  if (!/<html\b[^>]*\blang\s*=/i.test(html)) {
    html = html.replace(/<html\b/i, '<html lang="en"');
  }
  const ensureHead = () => {
    if (/<head[\s>]/i.test(html)) return;
    html = html.replace(/<html\b[^>]*>/i, (open) => `${open}\n  <head></head>`);
  };
  ensureHead();
  const injectHead = (snippet: string) => {
    html = html.replace(/<head([^>]*)>/i, (open) => `${open}\n    ${snippet}`);
  };
  if (!/<meta[^>]*name\s*=\s*["']viewport["']/i.test(html)) {
    injectHead('<meta name="viewport" content="width=device-width, initial-scale=1.0" />');
  }
  if (!/<meta[^>]*name\s*=\s*["']description["']/i.test(html)) {
    injectHead('<meta name="description" content="Generated application" />');
  }
  if (!/<title[\s>]/i.test(html)) {
    injectHead('<title>App</title>');
  }
  // Any module script pointing at a local file is the app entry. Appending a
  // second one (the previous behaviour whenever the entry was not `main.tsx`)
  // produced two roots — the generated entry plus the seeded `src/main.tsx` —
  // and mounted the app twice. Normalize the existing entry to the locked path
  // instead, and append only when the document has no local entry at all.
  const localModuleSrc = /\bsrc\s*=\s*["'](?!\/\/)(?![a-z][a-z0-9+.-]*:)[^"']+["']/i;
  const entry = [...html.matchAll(/<script\b[^>]*>/gi)].find(
    (tag) =>
      tag.index !== undefined &&
      /\btype\s*=\s*["']module["']/i.test(tag[0]) &&
      localModuleSrc.test(tag[0]),
  );
  const entryIndex = entry?.index;
  if (entry && entryIndex !== undefined) {
    const normalized = entry[0].replace(/(\bsrc\s*=\s*["'])[^"']*(["'])/i, '$1/src/main.tsx$2');
    html = `${html.slice(0, entryIndex)}${normalized}${html.slice(entryIndex + entry[0].length)}`;
  } else if (/<\/body>/i.test(html)) {
    html = html.replace(
      /<\/body>/i,
      '    <script type="module" src="/src/main.tsx"></script>\n  </body>',
    );
  } else {
    html += '\n<script type="module" src="/src/main.tsx"></script>\n';
  }
  return html;
}

function ensureTsconfig(content: string): { json: string; repaired: boolean; seeded: boolean } {
  const parsed = repairJson(content);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { json: content, repaired: false, seeded: false };
  }
  const obj = parsed as Record<string, unknown>;
  const compilerOptions =
    obj.compilerOptions &&
    typeof obj.compilerOptions === 'object' &&
    !Array.isArray(obj.compilerOptions)
      ? { ...(obj.compilerOptions as Record<string, unknown>) }
      : {};
  let changed = false;
  if (compilerOptions.jsx !== 'react-jsx') {
    compilerOptions.jsx = 'react-jsx';
    changed = true;
  }
  obj.compilerOptions = compilerOptions;
  const originallyValid = (() => {
    try {
      JSON.parse(content);
      return true;
    } catch {
      return false;
    }
  })();
  return { json: stringifyJson(obj), repaired: !originallyValid || changed, seeded: false };
}

function stripCall(source: string, name: string): string {
  const re = new RegExp(`\\b${name}\\s*\\(`);
  let out = source;
  while (true) {
    const match = re.exec(out);
    if (!match) break;
    const start = match.index;
    let i = start + match[0].length;
    let depth = 1;
    while (i < out.length && depth > 0) {
      if (out[i] === '(') depth += 1;
      else if (out[i] === ')') depth -= 1;
      i += 1;
    }
    let end = i;
    while (end < out.length && /[\s,]/.test(out[end]!)) {
      if (out[end] === ',') {
        end += 1;
        break;
      }
      end += 1;
    }
    out = `${out.slice(0, start)}${out.slice(end)}`;
    re.lastIndex = 0;
  }
  return out;
}

function ensureViteConfig(content: string): string {
  if (!VISUAL_EDITOR_RE.test(content) && !/\bvisualEditor\b/.test(content)) return content;
  let next = content.replace(
    /import\s+[^;]*?from\s+['"]@app-builder\/visual-editor['"]\s*;?\r?\n?/g,
    '',
  );
  next = next.replace(/import\s+['"]@app-builder\/visual-editor['"]\s*;?\r?\n?/g, '');
  next = stripCall(next, 'visualEditor');
  next = next.replace(/,\s*,/g, ',');
  next = next.replace(/\[\s*,/g, '[');
  next = next.replace(/,\s*\]/g, ']');
  return next.trim().length === 0 ? SEED_VITE_CONFIG : next;
}

export function applyStackContract(
  files: Map<string, string>,
  options?: ApplyStackContractOptions,
): StackContractResult {
  const next = new Map(files);
  const seeded: string[] = [];
  const repaired: string[] = [];
  const notes: string[] = [];

  for (const path of [...next.keys()]) {
    if (isForbiddenEnvPath(path)) {
      next.delete(path);
      notes.push(`removed forbidden ${path}`);
    }
  }

  let needsLucide = false;
  for (const [path, content] of next) {
    if (SOURCE_FILE_RE.test(path) && fileImportsLucide(content)) {
      needsLucide = true;
      break;
    }
  }

  for (const required of REQUIRED_FILE_PATHS) {
    if (isBlank(next.get(required))) {
      if (required === 'package.json') {
        const result = completePackageJson(undefined, {
          extraDependencies: needsLucide ? stackLock.conditionalDependencies : undefined,
        });
        next.set(required, result.json);
      } else {
        next.set(required, SEEDS[required]);
      }
      seeded.push(required);
    }
  }

  const packageResult = completePackageJson(next.get('package.json'), {
    extraDependencies: needsLucide ? stackLock.conditionalDependencies : undefined,
  });
  if (packageResult.json !== next.get('package.json')) {
    next.set('package.json', packageResult.json);
    if (packageResult.seeded && !seeded.includes('package.json')) seeded.push('package.json');
    if (packageResult.repaired) repaired.push('package.json');
    if (packageResult.completed) notes.push('completed package.json dependencies from stack-lock');
  }

  const tsconfig = next.get('tsconfig.json') ?? '';
  const tsResult = ensureTsconfig(tsconfig);
  if (tsResult.json !== tsconfig) {
    next.set('tsconfig.json', tsResult.json);
    if (tsResult.seeded && !seeded.includes('tsconfig.json')) seeded.push('tsconfig.json');
    if (tsResult.repaired) repaired.push('tsconfig.json');
  }

  const viteConfig = next.get('vite.config.ts') ?? '';
  const nextVite = isBlank(viteConfig) ? SEED_VITE_CONFIG : ensureViteConfig(viteConfig);
  if (nextVite !== viteConfig) {
    next.set('vite.config.ts', nextVite);
    if (isBlank(viteConfig) && !seeded.includes('vite.config.ts')) seeded.push('vite.config.ts');
    else if (!isBlank(viteConfig))
      notes.push('rewrote vite.config.ts to drop @app-builder/visual-editor');
  }

  const indexHtml = next.get('index.html') ?? '';
  const nextHtml = isBlank(indexHtml) ? SEED_INDEX_HTML : ensureIndexHtml(indexHtml);
  if (nextHtml !== indexHtml) {
    next.set('index.html', nextHtml);
    if (isBlank(indexHtml) && !seeded.includes('index.html')) seeded.push('index.html');
    else if (!isBlank(indexHtml)) notes.push('patched index.html contract attributes');
  }

  const envExample = next.get('.env.example') ?? '';
  const sanitizedEnv = sanitizeEnvExample(envExample);
  if (sanitizedEnv !== envExample) {
    next.set('.env.example', sanitizedEnv);
    notes.push('stripped non-VITE_ keys from .env.example');
  }

  const lucideRewrites: string[] = [];
  for (const [path, content] of next) {
    if (!SOURCE_FILE_RE.test(path) || !fileImportsLucide(content)) continue;
    const rewritten = rewriteLucideSource(content);
    if (rewritten.changed) {
      next.set(path, rewritten.source);
      lucideRewrites.push(path);
    }
  }
  if (lucideRewrites.length > 0) {
    notes.push(`rewrote lucide-react imports in ${lucideRewrites.join(', ')}`);
  }

  const replacements = options?.assetUrlReplacements;
  if (replacements && replacements.size > 0) {
    const rewrittenAssets: string[] = [];
    for (const [path, content] of next) {
      const updated = replacePreviewAssetUrls(content, replacements);
      if (updated !== content) {
        next.set(path, updated);
        rewrittenAssets.push(path);
      }
    }
    if (rewrittenAssets.length > 0) {
      notes.push(`rewrote preview asset URLs in ${rewrittenAssets.join(', ')}`);
    }
  }

  const changes = diffMaps(files, next);
  if (seeded.length > 0) notes.unshift(`seeded ${seeded.join(', ')}`);
  if (repaired.length > 0) notes.push(`repaired JSON in ${repaired.join(', ')}`);

  const syntheticToolResult =
    changes.length === 0
      ? null
      : [
          'autofix result:',
          ...notes.map((note) => `- ${note}`),
          'Do not delete required stack files. Do not write .env (use .env.example with VITE_* keys only).',
        ].join('\n');

  return { files: next, changes, seeded, repaired, syntheticToolResult };
}

export { isForbiddenEnvPath, REQUIRED_FILE_PATHS };
