export interface GeneratedFile {
  path: string;
  content: string;
}

export interface ClarifyingQuestion {
  question: string;
  options: [string, string, string];
}

export interface GenerationArtifact {
  message: string;
  questions: ClarifyingQuestion[];
  files: GeneratedFile[];
}
export interface GeneratedPatch {
  path: string;
  search: string;
  replace: string;
}

export interface PatchArtifact {
  message: string;
  patches: GeneratedPatch[];
}

const MESSAGE_START = '<<<MESSAGE>>>';
const MESSAGE_END = '<<<END_MESSAGE>>>';
const FILE_START = '<<<FILE:';
const FILE_HEADER_END = '>>>';
const FILE_END = '<<<END_FILE>>>';
const QUESTIONS_START = '<<<QUESTIONS>>>';
const QUESTIONS_END = '<<<END_QUESTIONS>>>';
const BUILD_END = '<<<END_BUILD>>>';

const PATCH_START = '<<<PATCH:';
const PATCH_END = '<<<END_PATCH>>>';
const SEARCH_START = '<<<<<<< SEARCH';
const REPLACE_START = '=======';
const REPLACE_END = '>>>>>>> REPLACE';
export function parsePatchArtifact(raw: string): PatchArtifact {
  const messageStart = raw.indexOf(MESSAGE_START);
  const messageEnd = raw.indexOf(MESSAGE_END, messageStart + MESSAGE_START.length);
  const message = messageStart >= 0 && messageEnd >= 0 ? raw.slice(messageStart + MESSAGE_START.length, messageEnd).trim() : '';
  const patches: GeneratedPatch[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf(PATCH_START, cursor);
    if (start < 0) break;
    const headerEnd = raw.indexOf('>>>', start + PATCH_START.length);
    if (headerEnd < 0) break;
    const end = raw.indexOf(PATCH_END, headerEnd + 3);
    if (end < 0) break;
    const path = raw.slice(start + PATCH_START.length, headerEnd).trim();
    const body = raw.slice(headerEnd + 3, end).replace(/^\r?\n/, '');
    const searchStart = body.indexOf(SEARCH_START);
    const replaceStart = body.indexOf(REPLACE_START, searchStart + SEARCH_START.length);
    const replaceEnd = body.indexOf(REPLACE_END, replaceStart + REPLACE_START.length);
    if (validPath(path) && searchStart >= 0 && replaceStart >= 0 && replaceEnd >= 0) {
      patches.push({
        path,
        search: body.slice(searchStart + SEARCH_START.length, replaceStart).replace(/^\r?\n/, '').replace(/\r?\n$/, ''),
        replace: body.slice(replaceStart + REPLACE_START.length, replaceEnd).replace(/^\r?\n/, '').replace(/\r?\n$/, ''),
      });
    }
    cursor = end + PATCH_END.length;
  }
  return { message, patches };
}

export function applyGeneratedPatches(files: GeneratedFile[], patches: GeneratedPatch[]): GeneratedFile[] {
  const contents = new Map(files.map((file) => [file.path, file.content]));
  for (const patch of patches) {
    const current = contents.get(patch.path);
    if (current === undefined) throw new Error(`Targeted edit file not found: ${patch.path}`);
    if (current.split(patch.search).length - 1 !== 1) throw new Error(`Targeted edit could not uniquely locate the selected element in ${patch.path}`);
    contents.set(patch.path, current.replace(patch.search, patch.replace));
  }
  return files.map((file) => ({ ...file, content: contents.get(file.path)! }));
}
export const GENERATION_PROTOCOL_PROMPT = `You are an autonomous website-building agent. Build the requested website by writing complete project files, not by explaining code.

If essential product intent is ambiguous and different answers would materially change the result, ask 1-3 concise clarifying questions before writing files. Each question must include exactly three useful, distinct recommended answers. Return only:
<<<QUESTIONS>>>
[{"question":"What kind of experience should this be?","options":["Focused single-player experience","Competitive multiplayer experience","Relaxed sandbox experience"]}]
<<<END_QUESTIONS>>>

Ask only when the answer is not already present in the request, conversation, project description, or current files. Do not ask about minor details you can choose sensibly. Otherwise return only this streaming artifact protocol, with no markdown fences and no text outside the markers:
<<<MESSAGE>>>
One short user-facing summary of what you built.
<<<END_MESSAGE>>>
<<<FILE:index.html>>>
Complete file contents
<<<END_FILE>>>
<<<FILE:src/styles.css>>>
Complete file contents
<<<END_FILE>>>
<<<END_BUILD>>>
Requirements:
- For a new project, emit index.html. For an existing project, emit only files that must change; never repeat unchanged files.
- Build a polished, responsive, accessible site that works immediately.
- Use complete file contents, never patches or ellipses.
- Prefer a dependency-free HTML/CSS/JavaScript site so preview starts instantly. Include Tailwind CDN (<script src="https://cdn.tailwindcss.com"></script>) or custom CSS with smooth transitions and keyframe animations. Never write global prefers-reduced-motion rules with animation-duration: 0.01ms !important on all elements (*), as it freezes watch hands, canvas loops, and clock movements.
- You may create src/styles.css and src/main.js and reference them from index.html.
- Do not use markdown code fences.
- Paths must be relative and may not contain .., backslashes, or leading slashes.
- For games and substantial apps, split behavior into focused files instead of producing one enormous index.html.
- Apps may include multiple screens, persistent state in localStorage, forms, navigation, dashboards, and rich interactions using dependency-free HTML/CSS/JavaScript.
- Games may include a canvas, deterministic update loop, input handling, collision/state systems, scoring, pause/restart controls, and responsive sizing.
- Prioritize a complete working core over oversized static markup. Every newly referenced local file must be emitted.
- If the build is too large for one response, finish the current file cleanly when possible; the system will request continuation for remaining files.
- After every requested file is complete, emit <<<END_BUILD>>> exactly once. This marker means the entire build—not merely the current file—is finished.
- Keep the summary out of files and keep code out of the summary.`;

function validPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 240 &&
    !path.startsWith('/') &&
    !path.includes('..') &&
    !path.includes('\\') &&
    !path.includes('\0')
  );
}

export function parseGenerationArtifact(raw: string): GenerationArtifact {
  const messageStart = raw.indexOf(MESSAGE_START);
  const messageEnd = raw.indexOf(MESSAGE_END, messageStart + MESSAGE_START.length);
  const message =
    messageStart >= 0 && messageEnd >= 0
      ? raw.slice(messageStart + MESSAGE_START.length, messageEnd).trim()
      : '';

  let questions: ClarifyingQuestion[] = [];
  const questionsStart = raw.indexOf(QUESTIONS_START);
  const questionsEnd = raw.indexOf(QUESTIONS_END, questionsStart + QUESTIONS_START.length);
  if (questionsStart >= 0 && questionsEnd >= 0) {
    const payload = raw.slice(questionsStart + QUESTIONS_START.length, questionsEnd).trim();
    try {
      const parsed = JSON.parse(payload) as unknown;
      if (Array.isArray(parsed)) {
        questions = parsed.flatMap((entry): ClarifyingQuestion[] => {
          if (typeof entry === 'string') {
            const question = entry.trim();
            return question ? [{ question, options: ['Use the recommended approach', 'Keep it simple', 'Make it feature-rich'] }] : [];
          }
          if (!entry || typeof entry !== 'object') return [];
          const record = entry as Record<string, unknown>;
          const question = typeof record.question === 'string' ? record.question.trim() : '';
          const options = Array.isArray(record.options)
            ? record.options.filter((option): option is string => typeof option === 'string').map((option) => option.trim()).filter(Boolean)
            : [];
          return question && options.length >= 3
            ? [{ question, options: [options[0]!, options[1]!, options[2]!] }]
            : [];
        }).slice(0, 3);
      }
    } catch {
      questions = [];
    }
  }

  const filesMap = new Map<string, string>();
  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf(FILE_START, cursor);
    if (start < 0) break;
    const headerEnd = raw.indexOf(FILE_HEADER_END, start + FILE_START.length);
    if (headerEnd < 0) break;
    const path = raw.slice(start + FILE_START.length, headerEnd).trim();
    const end = raw.indexOf(FILE_END, headerEnd + FILE_HEADER_END.length);
    if (end < 0) break;
    if (validPath(path)) {
      const content = raw.slice(headerEnd + FILE_HEADER_END.length, end).replace(/^\r?\n/, '').replace(/\r?\n$/, '');
      // Keep the last occurrence so the model can revisit and overwrite a file.
      filesMap.set(path, content);
    }
    cursor = end + FILE_END.length;
  }
  const files: GeneratedFile[] = [];
  for (const [path, content] of filesMap) {
    files.push({ path, content });
  }
  return { message, questions, files };
}

export function appendGenerationContinuation(raw: string, continuation: string): string {
  const active = getActiveGeneratedFile(raw);
  if (!active || raw.includes(FILE_END, raw.lastIndexOf(FILE_START))) return raw + continuation;

  const repeatedMarker = `${FILE_START}${active.path}${FILE_HEADER_END}`;
  const markerIndex = continuation.indexOf(repeatedMarker);
  if (markerIndex < 0) return raw + continuation;

  let suffix = continuation.slice(markerIndex + repeatedMarker.length).replace(/^\r?\n/, '');
  if (suffix.startsWith(active.content)) suffix = suffix.slice(active.content.length);
  return raw + suffix;
}

export function isGenerationArtifactComplete(raw: string): boolean {
  const questionsStart = raw.indexOf(QUESTIONS_START);
  if (questionsStart >= 0) {
    return raw.indexOf(QUESTIONS_END, questionsStart + QUESTIONS_START.length) >= 0;
  }

  return raw.indexOf(BUILD_END) >= 0;
}

export function getGenerationContinuationPrompt(raw: string): string {
  const completedPaths = parseGenerationArtifact(raw).files.map((file) => file.path);
  const lastFileStart = raw.lastIndexOf(FILE_START);
  if (lastFileStart >= 0) {
    const headerEnd = raw.indexOf(FILE_HEADER_END, lastFileStart + FILE_START.length);
    if (headerEnd >= 0 && raw.indexOf(FILE_END, headerEnd + FILE_HEADER_END.length) < 0) {
      const path = raw.slice(lastFileStart + FILE_START.length, headerEnd).trim();
      return `The response was truncated inside ${JSON.stringify(path)}. Continue its file body from immediately after the previous final character. Do not repeat the file marker or any existing content. Close it with <<<END_FILE>>>, emit every remaining required file, then emit <<<END_BUILD>>> exactly once.`;
    }
  }

  const completed = completedPaths.length > 0 ? completedPaths.join(', ') : 'none';
  return `Continue the same build without restarting. Completed files: ${completed}. Do not repeat them. Begin with the next required file marker, emit every remaining complete file, then emit <<<END_BUILD>>> exactly once.`;
}

export function getActiveGeneratedFile(raw: string): GeneratedFile | null {
  const start = raw.lastIndexOf(FILE_START);
  if (start < 0) return null;
  const headerEnd = raw.indexOf(FILE_HEADER_END, start + FILE_START.length);
  if (headerEnd < 0) return null;
  const path = raw.slice(start + FILE_START.length, headerEnd).trim();
  if (!validPath(path)) return null;
  const completeEnd = raw.indexOf(FILE_END, headerEnd + FILE_HEADER_END.length);
  const end = completeEnd >= 0 ? completeEnd : raw.length;
  const content = raw.slice(headerEnd + FILE_HEADER_END.length, end).replace(/^\r?\n/, '');
  return { path, content };
}

// ─── Thinking / Chain-of-Thought parsing ────────────────

const THINK_PATTERNS = [
  /\[think\]([\s\S]*?)\[\/think\]/gi,
  /\[THINK\]([\s\S]*?)\[\/THINK\]/gi,
  /\[thinking\]([\s\S]*?)\[\/thinking\]/gi,
  /\[reasoning\]([\s\S]*?)\[\/reasoning\]/gi,
  /\[REASONING\]([\s\S]*?)\[\/REASONING\]/gi,
  /```think\s*\n([\s\S]*?)```/gi,
  /```reasoning\s*\n([\s\S]*?)```/gi,
];

/**
 * Extract think/reasoning blocks from raw model output and strip them from the text.
 * Returns the joined thinking text and the cleaned text.
 */
export function extractThinking(raw: string): { thinking: string; cleaned: string } {
  const blocks: string[] = [];
  let cleaned = raw;
  for (const pattern of THINK_PATTERNS) {
    cleaned = cleaned.replace(pattern, (_match, content) => {
      blocks.push(content.trim());
      return '';
    });
  }
  return { thinking: blocks.join('\n\n'), cleaned };
}
