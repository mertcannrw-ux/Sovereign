import type { ClarifyingQuestion, GeneratedFile } from '@/lib/generation-protocol';

export interface ImageJobSpec {
  prompt: string;
  semanticUse: string;
  placeholderToken: string;
}

export interface AgentReadRequest {
  path: string;
  startLine?: number;
  endLine?: number;
}

export interface DesignDirectionConcept {
  title: string;
  visualBrief: string;
  imagePrompt: string;
  palette: {
    primary: string;
    secondary: string;
    background: string;
    accent: string;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
    styleNotes: string;
  };
  layoutNotes: string;
}

export type AgentAction =
  | { type: 'batch'; actions: Array<Exclude<AgentAction, { type: 'batch' }>> }
  | { type: 'think'; summary: string; content: string }
  | { type: 'read_files'; files: AgentReadRequest[] }
  | { type: 'write_file'; path: string; content: string }
  | { type: 'edit_file'; path: string; search: string; replace: string }
  | { type: 'delete_file'; path: string }
  | { type: 'ask_questions'; questions: ClarifyingQuestion[] }
  | { type: 'generate_images'; images: ImageJobSpec[] }
  | {
      type: 'propose_design_directions';
      directions: [DesignDirectionConcept, DesignDirectionConcept, DesignDirectionConcept];
    }
  | { type: 'respond'; message: string }
  | { type: 'finish'; summary: string };

/**
 * Returns a user-facing guard error when a model tries to propose visual
 * directions in an unsafe context. Existing projects must be edited in place;
 * proposals are only valid for an empty project and never alongside mutations.
 */
export function getDesignDirectionActionError(
  action: AgentAction,
  hasExistingFiles: boolean,
): string | null {
  const containsProposal =
    action.type === 'propose_design_directions' ||
    (action.type === 'batch' &&
      action.actions.some((item) => item.type === 'propose_design_directions'));
  if (!containsProposal) return null;
  if (hasExistingFiles) {
    return 'Design directions are only available for an empty project. This project already has files; inspect and edit the existing application instead of redesigning it.';
  }
  if (action.type === 'batch') {
    return 'Design directions must be the only action in their turn. Do not mutate project files in the same turn.';
  }
  return null;
}

export type AgentStepKind =
  'thinking' | 'read' | 'write' | 'edit' | 'delete' | 'verify' | 'image' | 'direction';

export interface AgentStep {
  id: string;
  kind: AgentStepKind;
  title: string;
  detail?: string;
  status: 'running' | 'complete' | 'failed';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

export interface AgentToolResult {
  message: string;
  files?: GeneratedFile[];
}

const MAX_PATH_LENGTH = 240;
const MAX_READ_FILES = 12;
const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_IMAGES_PER_ACTION = 8;
export const MAX_IMAGES_PER_RUN = 16;

export function isSafeAgentPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= MAX_PATH_LENGTH &&
    !path.startsWith('/') &&
    !path.includes('..') &&
    !path.includes('\\') &&
    !path.includes('\0')
  );
}

function parseQuestions(value: unknown): ClarifyingQuestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item): ClarifyingQuestion[] => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      const question = typeof record.question === 'string' ? record.question.trim() : '';
      const options = Array.isArray(record.options)
        ? record.options
            .filter((option): option is string => typeof option === 'string')
            .map((option) => option.trim())
            .filter(Boolean)
        : [];
      return question && options.length >= 3
        ? [{ question, options: [options[0]!, options[1]!, options[2]!] }]
        : [];
    })
    .slice(0, 3);
}

function extractJsonObjects(raw: string): unknown[] {
  const values: unknown[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (character !== '}' || depth === 0) continue;
    depth -= 1;
    if (depth !== 0 || start < 0) continue;
    try {
      values.push(JSON.parse(raw.slice(start, index + 1)) as unknown);
    } catch {
      // Ignore malformed candidates; a later complete object may still be usable.
    }
    start = -1;
  }
  return values;
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = (fenced ?? raw).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Agent returned no JSON action');
    return JSON.parse(candidate.slice(start, end + 1));
  }
}
const FILE_MUTATION_INTENT = /"type"\s*:\s*"(?:write_file|edit_file|delete_file)"/;

export function getAgentFileMutationPaths(action: AgentAction): Set<string> {
  const actions = action.type === 'batch' ? action.actions : [action];
  return new Set(
    actions.flatMap((item) =>
      item.type === 'write_file' || item.type === 'edit_file' || item.type === 'delete_file'
        ? [item.path]
        : [],
    ),
  );
}

export function stripEmbeddedJsonToolActions(message: string): string {
  return message
    .replace(
      /\{[\s\S]*?"type"\s*:\s*"(?:propose_design_directions|write_file|edit_file|delete_file|generate_images|read_files|think|ask_questions|respond|finish)"[\s\S]*?\}/g,
      '',
    )
    .trim();
}

function parseActionSequence(values: unknown[]): AgentAction {
  const actions = values.map((item) => parseAgentAction(JSON.stringify(item)));
  if (actions.length === 0 || actions.some((action) => action.type === 'batch')) {
    throw new Error('Action sequence is invalid');
  }
  if (actions.length === 1) return actions[0]!;
  return { type: 'batch', actions: actions as Array<Exclude<AgentAction, { type: 'batch' }>> };
}

export function parseAgentAction(raw: string): AgentAction {
  const embeddedValues = extractJsonObjects(raw);
  if (embeddedValues.length > 1) return parseActionSequence(embeddedValues);
  let value: unknown;
  try {
    value = extractJson(raw);
  } catch (error) {
    const rawMessage = raw.trim();
    const message = stripEmbeddedJsonToolActions(rawMessage);
    if (message && !message.startsWith('{') && !FILE_MUTATION_INTENT.test(message)) {
      return { type: 'respond', message };
    }
    throw error;
  }
  if (Array.isArray(value)) return parseActionSequence(value);
  if (!value || typeof value !== 'object') throw new Error('Agent action must be an object');
  const action = value as Record<string, unknown>;
  const type = action.type;

  if (type === 'think') {
    const summary = typeof action.summary === 'string' ? action.summary.trim() : '';
    const contentCandidates = [action.content, action.message, action.thinking, action.reasoning];
    const content =
      contentCandidates
        .find((candidate): candidate is string => typeof candidate === 'string')
        ?.trim() ?? '';
    const resolvedContent = content || summary || 'Considering the next useful step.';
    const resolvedSummary =
      summary || resolvedContent.split(/\r?\n|[.!?]\s/)[0]?.slice(0, 80) || 'Thinking';
    return { type, summary: resolvedSummary, content: resolvedContent };
  }
  if (type === 'read_files') {
    const rawFiles = Array.isArray(action.files)
      ? action.files
      : Array.isArray(action.paths)
        ? action.paths.map((path) => ({ path }))
        : [];
    if (rawFiles.length === 0 || rawFiles.length > MAX_READ_FILES) {
      throw new Error('Read action must contain between 1 and 12 file requests');
    }
    const files = rawFiles.map((item, idx): AgentReadRequest => {
      if (!item || typeof item !== 'object') {
        throw new Error(`Read request at index ${idx} is invalid`);
      }
      const obj = item as Record<string, unknown>;
      const path = typeof obj.path === 'string' ? obj.path.trim() : '';
      const startLine =
        obj.startLine === undefined
          ? undefined
          : typeof obj.startLine === 'number'
            ? obj.startLine
            : null;
      const endLine =
        obj.endLine === undefined
          ? undefined
          : typeof obj.endLine === 'number'
            ? obj.endLine
            : null;
      if (!isSafeAgentPath(path)) {
        throw new Error(`Read request at index ${idx} has an invalid path`);
      }
      if (
        startLine === null ||
        endLine === null ||
        (startLine !== undefined && (!Number.isInteger(startLine) || startLine < 1)) ||
        (endLine !== undefined && (!Number.isInteger(endLine) || endLine < 1))
      ) {
        throw new Error(`Read request at index ${idx} has invalid line bounds`);
      }
      if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
        throw new Error(`Read request at index ${idx} has a reversed line range`);
      }
      return {
        path,
        ...(startLine !== undefined ? { startLine } : {}),
        ...(endLine !== undefined ? { endLine } : {}),
      };
    });
    const unique = new Map<string, AgentReadRequest>();
    for (const file of files) {
      unique.set(`${file.path}:${file.startLine ?? ''}:${file.endLine ?? ''}`, file);
    }
    return { type, files: [...unique.values()] };
  }
  if (type === 'write_file') {
    const path = typeof action.path === 'string' ? action.path.trim() : '';
    const content = typeof action.content === 'string' ? action.content : null;
    if (!isSafeAgentPath(path) || content === null) throw new Error('Write action is invalid');
    if (new TextEncoder().encode(content).length > MAX_FILE_BYTES)
      throw new Error(`File exceeds ${MAX_FILE_BYTES} byte limit`);
    return { type, path, content };
  }
  if (type === 'edit_file') {
    const path = typeof action.path === 'string' ? action.path.trim() : '';
    const search = typeof action.search === 'string' ? action.search : '';
    const replace = typeof action.replace === 'string' ? action.replace : '';
    if (!isSafeAgentPath(path) || !search) throw new Error('Edit action is invalid');
    return { type, path, search, replace };
  }
  if (type === 'delete_file') {
    const path = typeof action.path === 'string' ? action.path.trim() : '';
    if (!isSafeAgentPath(path)) throw new Error('Delete action is invalid');
    return { type, path };
  }
  if (type === 'ask_questions') {
    const questions = parseQuestions(action.questions);
    if (questions.length === 0) throw new Error('Question action requires valid questions');
    return { type, questions };
  }
  if (type === 'respond') {
    const rawMessage = typeof action.message === 'string' ? action.message : '';
    const message = stripEmbeddedJsonToolActions(rawMessage);
    if (!message) throw new Error('Respond action requires a valid text message');
    return { type, message };
  }
  if (type === 'finish') {
    const summary = typeof action.summary === 'string' ? action.summary.trim() : '';
    if (!summary) throw new Error('Finish action requires a summary');
    return { type, summary };
  }
  if (type === 'generate_images') {
    const rawImages = Array.isArray(action.images) ? action.images : [];
    if (rawImages.length === 0) {
      throw new Error('generate_images action must contain at least one image specification.');
    }
    if (rawImages.length > MAX_IMAGES_PER_ACTION) {
      throw new Error(
        `generate_images action may contain at most ${MAX_IMAGES_PER_ACTION} image specifications.`,
      );
    }
    const images: ImageJobSpec[] = rawImages.map((item, idx) => {
      if (!item || typeof item !== 'object') {
        throw new Error(`Image spec at index ${idx} is invalid`);
      }
      const obj = item as Record<string, unknown>;
      const prompt = typeof obj.prompt === 'string' ? obj.prompt.trim() : '';
      const semanticUse = typeof obj.semanticUse === 'string' ? obj.semanticUse.trim() : '';
      const placeholderToken =
        typeof obj.placeholderToken === 'string' ? obj.placeholderToken.trim() : '';
      if (!prompt || prompt.length > 500) {
        throw new Error(`Image spec at index ${idx} requires a valid prompt (1-500 chars)`);
      }
      if (!semanticUse || semanticUse.length > 100) {
        throw new Error(`Image spec at index ${idx} requires a valid semanticUse (1-100 chars)`);
      }
      if (!placeholderToken || placeholderToken.length > 200) {
        throw new Error(
          `Image spec at index ${idx} requires a valid placeholderToken (1-200 chars)`,
        );
      }
      return { prompt, semanticUse, placeholderToken };
    });
    return { type, images };
  }
  if (type === 'propose_design_directions') {
    const rawDirections = Array.isArray(action.directions) ? action.directions : [];
    if (rawDirections.length !== 3) {
      throw new Error('propose_design_directions action must contain exactly 3 direction concepts');
    }
    const directions = rawDirections.map((item, idx) => {
      if (!item || typeof item !== 'object') {
        throw new Error(`Direction concept at index ${idx} is invalid`);
      }
      const obj = item as Record<string, unknown>;
      const title = typeof obj.title === 'string' ? obj.title.trim() : '';
      const visualBrief = typeof obj.visualBrief === 'string' ? obj.visualBrief.trim() : '';
      const imagePrompt = typeof obj.imagePrompt === 'string' ? obj.imagePrompt.trim() : '';
      const layoutNotes = typeof obj.layoutNotes === 'string' ? obj.layoutNotes.trim() : '';

      const paletteObj = (
        obj.palette && typeof obj.palette === 'object' ? obj.palette : {}
      ) as Record<string, unknown>;
      const primary = typeof paletteObj.primary === 'string' ? paletteObj.primary.trim() : '';
      const secondary = typeof paletteObj.secondary === 'string' ? paletteObj.secondary.trim() : '';
      const background =
        typeof paletteObj.background === 'string' ? paletteObj.background.trim() : '';
      const accent = typeof paletteObj.accent === 'string' ? paletteObj.accent.trim() : '';

      const typoObj = (
        obj.typography && typeof obj.typography === 'object' ? obj.typography : {}
      ) as Record<string, unknown>;
      const headingFont = typeof typoObj.headingFont === 'string' ? typoObj.headingFont.trim() : '';
      const bodyFont = typeof typoObj.bodyFont === 'string' ? typoObj.bodyFont.trim() : '';
      const styleNotes = typeof typoObj.styleNotes === 'string' ? typoObj.styleNotes.trim() : '';

      if (!title || title.length > 100)
        throw new Error(`Direction concept at index ${idx} requires title (1-100 chars)`);
      if (!visualBrief || visualBrief.length > 500)
        throw new Error(`Direction concept at index ${idx} requires visualBrief (1-500 chars)`);
      if (!imagePrompt || imagePrompt.length > 500)
        throw new Error(`Direction concept at index ${idx} requires imagePrompt (1-500 chars)`);
      if (!layoutNotes || layoutNotes.length > 500)
        throw new Error(`Direction concept at index ${idx} requires layoutNotes (1-500 chars)`);

      if (!primary || !secondary || !background || !accent) {
        throw new Error(`Direction concept at index ${idx} requires complete palette`);
      }
      if (!headingFont || !bodyFont) {
        throw new Error(`Direction concept at index ${idx} requires typography fonts`);
      }

      return {
        title,
        visualBrief,
        imagePrompt,
        palette: { primary, secondary, background, accent },
        typography: { headingFont, bodyFont, styleNotes },
        layoutNotes,
      };
    }) as [DesignDirectionConcept, DesignDirectionConcept, DesignDirectionConcept];

    return { type, directions };
  }
  throw new Error(`Unsupported agent action: ${String(type)}`);
}

interface StreamingJsonString {
  value: string;
  complete: boolean;
}

function getStreamingJsonString(
  raw: string,
  field: string,
  fromIndex: number,
): StreamingJsonString | null {
  const matcher = new RegExp(`"${field}"\\s*:\\s*"`, 'g');
  matcher.lastIndex = fromIndex;
  const match = matcher.exec(raw);
  if (!match) return null;
  const start = match.index + match[0].length;
  let value = '';
  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index]!;
    if (character === '"') return { value, complete: true };
    if (character !== '\\') {
      value += character;
      continue;
    }
    if (index + 1 >= raw.length) return { value, complete: false };
    const escape = raw[index + 1]!;
    if (escape === 'u') {
      const hex = raw.slice(index + 2, index + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { value, complete: false };
      value += String.fromCharCode(Number.parseInt(hex, 16));
      index += 5;
      continue;
    }
    const escapes: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
    };
    value += escapes[escape] ?? escape;
    index += 1;
  }
  return { value, complete: false };
}

function lastActionIndex(raw: string, type: 'write_file' | 'edit_file'): number {
  const matcher = new RegExp(`"type"\\s*:\\s*"${type}"`, 'g');
  let index = -1;
  for (const match of raw.matchAll(matcher)) index = match.index;
  return index;
}

export type StreamingFileAction =
  | { type: 'write_file'; path: string; content: string }
  | { type: 'edit_file'; path: string; search: string; replace: string };

export function getStreamingFileAction(raw: string): StreamingFileAction | null {
  const latestWrite = lastActionIndex(raw, 'write_file');
  const latestEdit = lastActionIndex(raw, 'edit_file');
  const actionIndex = Math.max(latestWrite, latestEdit);
  if (actionIndex < 0) return null;
  const path = getStreamingJsonString(raw, 'path', actionIndex);
  if (!path?.complete || !isSafeAgentPath(path.value)) return null;
  if (latestWrite > latestEdit) {
    const content = getStreamingJsonString(raw, 'content', actionIndex);
    return content ? { type: 'write_file', path: path.value, content: content.value } : null;
  }
  const search = getStreamingJsonString(raw, 'search', actionIndex);
  const replace = getStreamingJsonString(raw, 'replace', actionIndex);
  return search?.complete && replace
    ? { type: 'edit_file', path: path.value, search: search.value, replace: replace.value }
    : null;
}

export function getStreamingThought(raw: string): string | null {
  if (!/"type"\s*:\s*"think"/.test(raw)) return null;
  const fields = ['content', 'thinking', 'reasoning', 'summary'];
  let match: RegExpExecArray | null = null;
  for (const field of fields) {
    const re = new RegExp(`"${field}"\\s*:\\s*"`);
    match = re.exec(raw);
    if (match) break;
  }
  if (!match) return null;
  const start = match.index + match[0].length;
  let decoded = '';
  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index]!;
    if (character === '"') return decoded;
    if (character !== '\\') {
      decoded += character;
      continue;
    }
    if (index + 1 >= raw.length) break;
    const escape = raw[index + 1]!;
    if (escape === 'u') {
      const hex = raw.slice(index + 2, index + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      decoded += String.fromCharCode(Number.parseInt(hex, 16));
      index += 5;
      continue;
    }
    const escapes: Record<string, string> = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
    };
    decoded += escapes[escape] ?? escape;
    index += 1;
  }
  return decoded;
}

export function applyAgentEdit(content: string, search: string, replace: string): string {
  const occurrences = content.split(search).length - 1;
  if (occurrences !== 1)
    throw new Error(`Edit search must match exactly once; found ${occurrences}`);
  return content.replace(search, replace);
}

/**
 * 1-indexed line and 0-indexed column of the character at `index` in `content`
 * (an out-of-range index clamps to the end, so `content.length` means "end of
 * file"). This is the streaming AI cursor's position source: the server calls
 * it with the end of the streamed fragment so the cursor tracks where the model
 * is actually writing. O(n) over the prefix, no line-array allocation, because
 * the generate route calls it on every throttled preview emit.
 */
export function cursorPositionAt(
  content: string,
  index: number,
): { line: number; column: number } {
  const end = Math.max(0, Math.min(index, content.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < end; i += 1) {
    if (content.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart };
}
