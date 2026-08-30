import lucideLock from './lucide-0.487-exports.json';

/** Canonical lucide-react@0.487.0 named icon components. */
export const LUCIDE_EXPORTS = new Set<string>(lucideLock.exports);

/** Deprecated / suffixed lucide-react@0.487.0 aliases → canonical export. */
const LUCIDE_ALIASES = lucideLock.aliases as Record<string, string>;

const FALLBACK_EXPORT = 'Circle';

const RESERVED_EXPORTS = new Set([
  'LucideIcon',
  'LucideProps',
  'createLucideIcon',
  'icons',
]);

/** Heroicon / FA / MD names this builder sees that are not lucide aliases. */
const EXTRA_ALIASES: Record<string, string> = {
  AdjustmentsHorizontal: 'SlidersHorizontal',
  AdjustmentsHorizontalIcon: 'SlidersHorizontal',
  AdjustmentsVertical: 'SlidersHorizontal',
  ArrowPath: 'RefreshCw',
  ArrowPathIcon: 'RefreshCw',
  ArrowTopRightOnSquare: 'ExternalLink',
  ArrowTopRightOnSquareIcon: 'ExternalLink',
  Bars3: 'Menu',
  Bars3Icon: 'Menu',
  Bars4: 'Menu',
  Cog6Tooth: 'Settings',
  Cog6ToothIcon: 'Settings',
  Cog8Tooth: 'Settings',
  Cog8ToothIcon: 'Settings',
  Document: 'File',
  DocumentIcon: 'File',
  DocumentText: 'FileText',
  DocumentTextIcon: 'FileText',
  EllipsisHorizontal: 'MoreHorizontal',
  EllipsisHorizontalIcon: 'MoreHorizontal',
  EllipsisVertical: 'MoreVertical',
  EllipsisVerticalIcon: 'MoreVertical',
  Envelope: 'Mail',
  EnvelopeIcon: 'Mail',
  ExclamationCircle: 'CircleAlert',
  ExclamationCircleIcon: 'CircleAlert',
  ExclamationTriangle: 'TriangleAlert',
  ExclamationTriangleIcon: 'TriangleAlert',
  InformationCircle: 'Info',
  InformationCircleIcon: 'Info',
  MagnifyingGlass: 'Search',
  MagnifyingGlassIcon: 'Search',
  PencilSquare: 'SquarePen',
  PencilSquareIcon: 'SquarePen',
  Photo: 'Image',
  PhotoIcon: 'Image',
  QuestionMarkCircle: 'CircleHelp',
  QuestionMarkCircleIcon: 'CircleHelp',
  TrashIcon: 'Trash2',
  XMark: 'X',
  XMarkIcon: 'X',
};

const LIB_PREFIX =
  /^(?:HiOutline|HiSolid|HiMini|Io5|Fa6|Fa|Md|Hi|Bs|Bi|Io|Ri|Ti|Gi|Cg|Tb|Fi|Rx|Pi|Sl|Si|Di|Im|Gr|Ai|Go|Lu)/;

const LUCIDE_FROM_RE =
  /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+(['"])lucide-react\2\s*;?/g;

interface NamedSpecifier {
  imported: string;
  local: string;
  isType: boolean;
}

export function fileImportsLucide(source: string): boolean {
  return /from\s+['"]lucide-react['"]/.test(source);
}

export function resolveLucideExport(name: string): string {
  if (RESERVED_EXPORTS.has(name)) return name;

  const direct = resolveKnown(name);
  if (direct) return direct;

  let normalized = name;
  if (normalized.startsWith('Lucide') && normalized.length > 6 && !RESERVED_EXPORTS.has(normalized)) {
    normalized = normalized.slice(6);
  }
  if (normalized.startsWith('Icon') && normalized.length > 4) normalized = normalized.slice(4);
  if (normalized.endsWith('Icon') && normalized.length > 4) normalized = normalized.slice(0, -4);
  normalized = normalized.replace(LIB_PREFIX, '');
  if (!normalized) return FALLBACK_EXPORT;

  return resolveKnown(normalized) ?? FALLBACK_EXPORT;
}

function resolveKnown(name: string): string | null {
  if (RESERVED_EXPORTS.has(name)) return name;
  if (Object.hasOwn(LUCIDE_ALIASES, name)) return LUCIDE_ALIASES[name]!;
  if (LUCIDE_EXPORTS.has(name)) return name;
  if (Object.hasOwn(EXTRA_ALIASES, name)) return EXTRA_ALIASES[name]!;
  if (name.endsWith('Icon') && name.length > 4) {
    const stem = name.slice(0, -4);
    if (Object.hasOwn(LUCIDE_ALIASES, stem)) return LUCIDE_ALIASES[stem]!;
    if (LUCIDE_EXPORTS.has(stem)) return stem;
    if (Object.hasOwn(EXTRA_ALIASES, stem)) return EXTRA_ALIASES[stem]!;
  }
  return null;
}

export function rewriteLucideSource(source: string): { source: string; changed: boolean } {
  if (!fileImportsLucide(source)) return { source, changed: false };

  const jsxRenames = new Map<string, string>();
  let next = source.replace(LUCIDE_FROM_RE, (full, clause: string, quote: string) => {
    const rewritten = rewriteImportClause(clause, jsxRenames);
    const endedWithSemi = /;\s*$/.test(full);
    const keyword = /^\s*import\s+type\s+/.test(full) ? 'import type' : 'import';
    return `${keyword} ${rewritten} from ${quote}lucide-react${quote}${endedWithSemi ? ';' : ''}`;
  });

  for (const [from, to] of jsxRenames) {
    if (from === to) continue;
    const pattern = new RegExp(`(<\\/?)${escapeRegExp(from)}(?=[\\s>/])`, 'g');
    next = next.replace(pattern, `$1${to}`);
  }

  return { source: next, changed: next !== source };
}

function rewriteImportClause(clause: string, jsxRenames: Map<string, string>): string {
  const trimmed = clause.trim();
  const namedMatch = trimmed.match(/^(?:(\w+)\s*,\s*)?\{([^}]*)\}(?:\s*,\s*(\w+))?$/);
  const namespaceMatch = trimmed.match(/^(?:(\w+)\s*,\s*)?\*\s+as\s+(\w+)$/);
  const defaultOnly = trimmed.match(/^(\w+)$/);

  if (namedMatch) {
    const defaultName = namedMatch[1] ?? namedMatch[3];
    const specifiers = parseNamedSpecifiers(namedMatch[2] ?? '');
    const nextNamed: string[] = [];
    const used = new Set<string>();
    for (const spec of specifiers) {
      const resolved = spec.isType && RESERVED_EXPORTS.has(spec.imported)
        ? spec.imported
        : resolveLucideExport(spec.imported);
      const rendered = formatSpecifier(spec, resolved);
      const key = rendered;
      if (!used.has(key)) {
        nextNamed.push(rendered);
        used.add(key);
      }
      if (!spec.isType && spec.local === spec.imported && resolved !== spec.imported) {
        jsxRenames.set(spec.local, resolved);
      }
    }
    if (defaultName) {
      const defaultSpec = `Circle as ${defaultName}`;
      if (!used.has(defaultSpec) && !used.has(FALLBACK_EXPORT)) {
        nextNamed.unshift(defaultSpec);
      }
    }
    return `{ ${nextNamed.join(', ')} }`;
  }

  if (namespaceMatch) {
    return `* as ${namespaceMatch[2]!}`;
  }

  if (defaultOnly) {
    return `{ ${FALLBACK_EXPORT} as ${defaultOnly[1]!} }`;
  }

  return `{ ${FALLBACK_EXPORT} }`;
}

function formatSpecifier(spec: NamedSpecifier, resolved: string): string {
  const typePrefix = spec.isType ? 'type ' : '';
  if (spec.local === spec.imported) {
    return `${typePrefix}${resolved}`;
  }
  return `${typePrefix}${resolved} as ${spec.local}`;
}

function parseNamedSpecifiers(inner: string): NamedSpecifier[] {
  const specifiers: NamedSpecifier[] = [];
  for (const part of inner.split(',').map((token) => token.trim()).filter(Boolean)) {
    const typedAlias = part.match(/^type\s+(\w+)\s+as\s+(\w+)$/);
    if (typedAlias) {
      specifiers.push({ imported: typedAlias[1]!, local: typedAlias[2]!, isType: true });
      continue;
    }
    const typed = part.match(/^type\s+(\w+)$/);
    if (typed) {
      specifiers.push({ imported: typed[1]!, local: typed[1]!, isType: true });
      continue;
    }
    const aliased = part.match(/^(\w+)\s+as\s+(\w+)$/);
    if (aliased) {
      specifiers.push({ imported: aliased[1]!, local: aliased[2]!, isType: false });
      continue;
    }
    const ident = part.match(/^(\w+)$/);
    if (ident) specifiers.push({ imported: ident[1]!, local: ident[1]!, isType: false });
  }
  return specifiers;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { FALLBACK_EXPORT };
