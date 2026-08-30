/** Curated lucide-react named exports this builder actually emits. Unknown icons fall back to Circle. */
const LUCIDE_EXPORTS = new Set<string>([
  'Activity',
  'Airplay',
  'AlarmClock',
  'AlertCircle',
  'AlertOctagon',
  'AlertTriangle',
  'AlignCenter',
  'AlignLeft',
  'AlignRight',
  'Anchor',
  'Aperture',
  'Archive',
  'ArrowDown',
  'ArrowDownLeft',
  'ArrowDownRight',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowUpLeft',
  'ArrowUpRight',
  'AtSign',
  'Award',
  'Ban',
  'Banknote',
  'BarChart',
  'BarChart2',
  'BarChart3',
  'Battery',
  'Bell',
  'BellOff',
  'Bluetooth',
  'Bold',
  'Book',
  'BookOpen',
  'Bookmark',
  'Box',
  'Boxes',
  'Briefcase',
  'Building',
  'Building2',
  'Bus',
  'Calculator',
  'Calendar',
  'CalendarCheck',
  'CalendarDays',
  'Camera',
  'CameraOff',
  'Car',
  'Cast',
  'Check',
  'CheckCheck',
  'CheckCircle',
  'CheckCircle2',
  'CheckSquare',
  'ChevronDown',
  'ChevronFirst',
  'ChevronLast',
  'ChevronLeft',
  'ChevronRight',
  'ChevronUp',
  'ChevronsDown',
  'ChevronsLeft',
  'ChevronsRight',
  'ChevronsUp',
  'ChevronsUpDown',
  'Circle',
  'CircleAlert',
  'CircleCheck',
  'CircleDot',
  'CircleHelp',
  'CircleMinus',
  'CirclePause',
  'CirclePlay',
  'CirclePlus',
  'CircleStop',
  'CircleUser',
  'CircleX',
  'Clipboard',
  'ClipboardCheck',
  'ClipboardCopy',
  'ClipboardList',
  'Clock',
  'Cloud',
  'CloudDownload',
  'CloudOff',
  'CloudRain',
  'CloudUpload',
  'Code',
  'Code2',
  'CodeXml',
  'Coffee',
  'Cog',
  'Columns',
  'Command',
  'Compass',
  'Copy',
  'Copyright',
  'CreditCard',
  'Crop',
  'Crosshair',
  'Crown',
  'Database',
  'Delete',
  'Disc',
  'DollarSign',
  'Download',
  'Droplet',
  'Edit',
  'Edit2',
  'Edit3',
  'Equal',
  'ExternalLink',
  'Eye',
  'EyeOff',
  'Facebook',
  'FastForward',
  'File',
  'FileCode',
  'FilePlus',
  'FileText',
  'Film',
  'Filter',
  'Flag',
  'Folder',
  'FolderOpen',
  'FolderPlus',
  'Frown',
  'Gamepad',
  'Gift',
  'GitBranch',
  'GitCommit',
  'GitMerge',
  'GitPullRequest',
  'Github',
  'Gitlab',
  'Globe',
  'GraduationCap',
  'Grid',
  'Grid2x2',
  'Grid3x3',
  'GripVertical',
  'Hammer',
  'HardDrive',
  'Hash',
  'Headphones',
  'Heart',
  'HelpCircle',
  'Hexagon',
  'Highlighter',
  'History',
  'Home',
  'Image',
  'ImageOff',
  'Inbox',
  'Info',
  'Instagram',
  'Italic',
  'Key',
  'Keyboard',
  'Laptop',
  'Layers',
  'Layout',
  'LayoutDashboard',
  'LayoutGrid',
  'LayoutList',
  'LifeBuoy',
  'Link',
  'Link2',
  'Linkedin',
  'List',
  'ListChecks',
  'ListFilter',
  'ListOrdered',
  'Loader',
  'Loader2',
  'LoaderCircle',
  'Lock',
  'LogIn',
  'LogOut',
  'Mail',
  'MailOpen',
  'Map',
  'MapPin',
  'Maximize',
  'Maximize2',
  'Meh',
  'Menu',
  'MessageCircle',
  'MessageSquare',
  'Mic',
  'MicOff',
  'Minimize',
  'Minimize2',
  'Minus',
  'Monitor',
  'Moon',
  'MoreHorizontal',
  'MoreVertical',
  'MousePointer',
  'Move',
  'Music',
  'Navigation',
  'Newspaper',
  'Octagon',
  'OctagonAlert',
  'Package',
  'Paperclip',
  'Pause',
  'PauseCircle',
  'Pen',
  'PenLine',
  'PenTool',
  'Pencil',
  'Percent',
  'Phone',
  'PhoneCall',
  'PhoneOff',
  'PieChart',
  'Play',
  'PlayCircle',
  'Plug',
  'Plus',
  'PlusCircle',
  'PlusSquare',
  'Pocket',
  'Power',
  'Printer',
  'Puzzle',
  'QrCode',
  'Radio',
  'RefreshCcw',
  'RefreshCw',
  'Repeat',
  'Reply',
  'Rewind',
  'Rocket',
  'RotateCcw',
  'RotateCw',
  'Rss',
  'Save',
  'Scale',
  'Scissors',
  'Search',
  'Send',
  'Server',
  'Settings',
  'Settings2',
  'Share',
  'Share2',
  'Sheet',
  'Shield',
  'ShieldAlert',
  'ShieldCheck',
  'ShieldOff',
  'ShoppingBag',
  'ShoppingCart',
  'Shuffle',
  'Sidebar',
  'SkipBack',
  'SkipForward',
  'Slack',
  'Sliders',
  'SlidersHorizontal',
  'Smartphone',
  'Smile',
  'Sparkles',
  'Speaker',
  'Square',
  'SquareCheck',
  'SquarePen',
  'Star',
  'StopCircle',
  'Sun',
  'Sunrise',
  'Sunset',
  'Table',
  'Tablet',
  'Tag',
  'Target',
  'Terminal',
  'Thermometer',
  'ThumbsDown',
  'ThumbsUp',
  'Timer',
  'ToggleLeft',
  'ToggleRight',
  'Trash',
  'Trash2',
  'Trello',
  'TrendingDown',
  'TrendingUp',
  'Triangle',
  'TriangleAlert',
  'Truck',
  'Tv',
  'Twitch',
  'Twitter',
  'Type',
  'Umbrella',
  'Underline',
  'Unlock',
  'Upload',
  'User',
  'UserCheck',
  'UserMinus',
  'UserPlus',
  'UserX',
  'Users',
  'Verified',
  'Video',
  'VideoOff',
  'Voicemail',
  'Volume',
  'Volume1',
  'Volume2',
  'VolumeX',
  'Wallet',
  'Watch',
  'Wifi',
  'WifiOff',
  'Wind',
  'Wrench',
  'X',
  'XCircle',
  'XOctagon',
  'XSquare',
  'Youtube',
  'Zap',
  'ZoomIn',
  'ZoomOut',
]);

const FALLBACK_EXPORT = 'Circle';

const ALIASES: Record<string, string> = {
  AdjustmentsHorizontal: 'SlidersHorizontal',
  AdjustmentsHorizontalIcon: 'SlidersHorizontal',
  AdjustmentsVertical: 'Sliders',
  AlertCircleIcon: 'CircleAlert',
  AlertTriangleIcon: 'TriangleAlert',
  ArrowPath: 'RefreshCw',
  ArrowPathIcon: 'RefreshCw',
  ArrowTopRightOnSquare: 'ExternalLink',
  ArrowTopRightOnSquareIcon: 'ExternalLink',
  Bars3: 'Menu',
  Bars3Icon: 'Menu',
  Bars4: 'Menu',
  CheckCircleIcon: 'CircleCheck',
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
  HomeIcon: 'Home',
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
  UserCircle: 'CircleUser',
  UserCircleIcon: 'CircleUser',
  XMark: 'X',
  XMarkIcon: 'X',
};

const LIB_PREFIX =
  /^(?:HiOutline|HiSolid|HiMini|Io5|Fa6|Fa|Md|Hi|Bs|Bi|Io|Ri|Ti|Gi|Cg|Tb|Fi|Rx|Pi|Sl|Si|Di|Im|Gr|Ai|Go|Lu)/;

const LUCIDE_FROM_RE =
  /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+(['"])lucide-react\2\s*;?/g;

export function fileImportsLucide(source: string): boolean {
  return /from\s+['"]lucide-react['"]/.test(source);
}

export function resolveLucideExport(name: string): string {
  if (LUCIDE_EXPORTS.has(name)) return name;
  if (ALIASES[name] && LUCIDE_EXPORTS.has(ALIASES[name]!)) return ALIASES[name]!;

  let normalized = name;
  if (normalized.startsWith('Lucide') && normalized.length > 6) normalized = normalized.slice(6);
  if (normalized.startsWith('Icon') && normalized.length > 4) normalized = normalized.slice(4);
  if (normalized.endsWith('Icon') && normalized.length > 4) normalized = normalized.slice(0, -4);
  normalized = normalized.replace(LIB_PREFIX, '');
  if (!normalized) return FALLBACK_EXPORT;

  if (LUCIDE_EXPORTS.has(normalized)) return normalized;
  if (ALIASES[normalized] && LUCIDE_EXPORTS.has(ALIASES[normalized]!)) return ALIASES[normalized]!;
  if (ALIASES[name]) return ALIASES[name]!;
  return FALLBACK_EXPORT;
}

export function rewriteLucideSource(source: string): { source: string; changed: boolean } {
  if (!fileImportsLucide(source)) return { source, changed: false };

  const identifierMap = new Map<string, string>();
  let next = source.replace(LUCIDE_FROM_RE, (full, clause: string, quote: string) => {
    const rewritten = rewriteImportClause(clause, identifierMap);
    const endedWithSemi = /;\s*$/.test(full);
    const keyword = /^\s*import\s+type\s+/.test(full) ? 'import type' : 'import';
    return `${keyword} ${rewritten} from ${quote}lucide-react${quote}${endedWithSemi ? ';' : ''}`;
  });

  if (identifierMap.size === 0) return { source: next, changed: next !== source };

  for (const [from, to] of identifierMap) {
    if (from === to) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(from)}\\b`, 'g');
    next = next.replace(pattern, to);
  }

  return { source: next, changed: next !== source };
}

function rewriteImportClause(clause: string, identifierMap: Map<string, string>): string {
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
      const resolved = resolveLucideExport(spec.imported);
      if (spec.local === spec.imported) {
        identifierMap.set(spec.local, resolved);
        if (!used.has(resolved)) {
          nextNamed.push(resolved);
          used.add(resolved);
        }
      } else if (resolved === spec.imported) {
        nextNamed.push(`${spec.imported} as ${spec.local}`);
        used.add(spec.local);
      } else {
        nextNamed.push(`${resolved} as ${spec.local}`);
        used.add(spec.local);
      }
    }
    const named = `{ ${nextNamed.join(', ')} }`;
    if (defaultName) {
      identifierMap.set(defaultName, FALLBACK_EXPORT);
      if (!used.has(FALLBACK_EXPORT)) nextNamed.unshift(FALLBACK_EXPORT);
      return `{ ${[...new Set([FALLBACK_EXPORT, ...nextNamed])].join(', ')} }`;
    }
    return named;
  }

  if (namespaceMatch) {
    const ns = namespaceMatch[2]!;
    return `* as ${ns}`;
  }

  if (defaultOnly) {
    identifierMap.set(defaultOnly[1]!, FALLBACK_EXPORT);
    return `{ ${FALLBACK_EXPORT} }`;
  }

  return `{ ${FALLBACK_EXPORT} }`;
}

function parseNamedSpecifiers(inner: string): Array<{ imported: string; local: string }> {
  return inner
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const aliased = part.match(/^(\w+)\s+as\s+(\w+)$/);
      if (aliased) return [{ imported: aliased[1]!, local: aliased[2]! }];
      const ident = part.match(/^(\w+)$/);
      if (!ident) return [];
      return [{ imported: ident[1]!, local: ident[1]! }];
    });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export { LUCIDE_EXPORTS, FALLBACK_EXPORT };
