import { createHash, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { getProvider, generateImage, ProviderError } from '@app-builder/ai-gateway';
import {
  applyStackContract,
  isForbiddenEnvPath,
  type StackContractChange,
} from '@app-builder/codegen';
import { TRPCError } from '@trpc/server';
import {
  assertPlanAllowsMaxDuration,
  resolveNoProgressGuard,
  resolveOptionalLimit,
} from '@/lib/agent-limits';
import { uploadProjectAsset } from '@/server/assets/project-assets';
import { getR2ConfigStatus } from '@/server/assets/r2';
import { AIProvider } from '@app-builder/shared';
import { getVerifiedSession } from '@/lib/auth';
import { decryptApiKey } from '@/lib/crypto';
import { getDb } from '@/lib/db';
import { requireProjectRole } from '@/server/authz';
import {
  applyAgentEdit,
  cursorPositionAt,
  getAgentFileMutationPaths,
  getDesignDirectionActionError,
  getSettledAnswer,
  getStreamingAnswer,
  getStreamingFileAction,
  getStreamingThought,
  parseAgentAction,
  MAX_IMAGES_PER_RUN,
  type AgentAction,
  type AgentReadRequest,
  type AgentStep,
} from '@/lib/agent-protocol';
import {
  SOVEREIGN_RUNTIME_TOOL,
  SOVEREIGN_TOOLS,
  actionsFromToolCalls,
  getStreamingFileFromToolCalls,
  nativeToolsEnabled,
} from '@/lib/agent-tools';
import type {
  DesignDirectionRecord,
  GenerationEvent,
  GenerationEventSink,
} from '@/lib/generation-stream';
import {
  RUNTIME_COMMAND_NAMES,
  formatRuntimeObservation,
  resolveRuntimeCommand,
  sanitizePreviewErrors,
  type RuntimeCommandResult,
} from '@/lib/runtime-commands';
import {
  RUNTIME_RESULT_GRACE_MS,
  RUNTIME_TRACE_ABORTED,
  RUNTIME_TRACE_PENDING,
  RUNTIME_TRACE_TIMEOUT,
  waitForRuntimeResult,
} from '@/lib/runtime-bridge';
import type { ToolCall } from '@app-builder/ai-gateway';
import { trimMessagesForContext, type AgentMessage } from '@/lib/context-window';
import {
  createVersion,
  tryClaimGenerationLease,
  renewGenerationLease,
  clearGenerationLease,
  GENERATION_LEASE_STALE_MS,
  assertGenerationLeaseOwned,
  type VersionDiffEntry,
} from '@/lib/versioning';
import { checkRateLimit } from '@/server/rate-limit';
import { isSovereignOverlayPath } from '@/lib/preview-startup';

export const dynamic = 'force-dynamic';
/**
 * Longest a single generate stream may run. The agent loop has no step cap, so
 * wall clock is the only bound left: 800s is Vercel's generally available
 * maximum for Fluid functions (Pro/Enterprise). This must stay a numeric
 * literal — Next extracts it statically (SWC) and silently drops non-literal
 * values (compute-in-environment or `Math.min(...)`) back to the platform
 * default. Hobby's ceiling is 300s and the build fails at deploy time above
 * it, so `assertPlanAllowsMaxDuration` turns the misconfiguration into a
 * startup error with the exact fix instead of a confusing Vercel build error.
 * Truly unbounded runs need Vercel Workflows (durable execution), not a
 * longer function timeout.
 */
export const maxDuration = 800;
assertPlanAllowsMaxDuration(maxDuration);

interface GenerateBody {
  projectId?: string;
  message?: string;
  modelProvider?: string;
  modelName?: string;
  files?: { path?: string; content?: string }[];
  reasoningEffort?: string;
  /** Recent preview console errors the client captured, sent with the turn. */
  runtimeErrors?: string[];
  editTarget?: {
    sourceFile?: string;
    tagName?: string;
    selector?: string;
    outerHTML?: string;
  };
  directionResponse?: {
    action: 'select' | 'skip' | 'regenerate';
    setId: string;
    directionId?: string;
  };
}

/**
 * Operator knobs. Both are off unless set — see `resolveOptionalLimit` for why
 * BYOK runs carry no default step or no-progress ceiling.
 */
const MAX_ITERATIONS = resolveOptionalLimit(process.env.SOVEREIGN_MAX_ITERATIONS);
const MAX_NO_PROGRESS_TURNS = resolveNoProgressGuard(process.env.SOVEREIGN_MAX_NO_PROGRESS);
const TURN_MAX_TOKENS =
  Number(process.env.SOVEREIGN_MAX_TOKENS) > 0
    ? Math.floor(Number(process.env.SOVEREIGN_MAX_TOKENS))
    : undefined;
const MAX_ATTACHMENT_BYTES = 512 * 1024;
const MAX_READ_RESULT_CHARS = 60_000;
const IMAGE_GENERATION_CONCURRENCY = 3;

function isRetryableImageError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    if (error.code === 'request_timeout') return true;
    if (error.status === 429) return true;
    if (error.status >= 500) return true;
    return false;
  }
  return true;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        results[index] = await mapper(items[index]!);
      }
    }),
  );
  return results;
}

function formatReadObservation(
  path: string,
  content: string | undefined,
  request: AgentReadRequest,
  budget: number,
): string {
  if (content === undefined) return `--- ${path} ---\n[not found]`;

  const firstLine = request.startLine ?? 1;
  let lineCount = 1;
  let firstLineStart = 0;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      lineCount += 1;
      if (lineCount === firstLine) firstLineStart = index + 1;
    }
  }
  const requestedLastLine = request.endLine ?? lineCount;
  if (firstLine > lineCount) {
    return `--- ${path} (lines ${firstLine}-${requestedLastLine}) ---\n[line range is outside the file; file has ${lineCount} lines]`;
  }

  const lastLine = Math.min(requestedLastLine, lineCount);
  const header =
    request.startLine === undefined && request.endLine === undefined
      ? `--- ${path} (full file, lines 1-${lineCount}) ---`
      : `--- ${path} (lines ${firstLine}-${lastLine}) ---`;
  const suffix = '\n… [read output truncated; request a smaller line range]';
  const available = Math.max(0, budget - header.length - 1);
  // Capture one sentinel character past the limit to detect truncation without
  // formatting the rest of a large file into a temporary string.
  const captureLimit = available + 1;
  let numbered = '';
  let exceededBudget = false;
  const appendText = (text: string) => {
    const remaining = captureLimit - numbered.length;
    if (text.length > remaining) {
      numbered += text.slice(0, remaining);
      exceededBudget = true;
    } else {
      numbered += text;
    }
  };
  const appendSource = (start: number, end: number) => {
    const remaining = captureLimit - numbered.length;
    const length = end - start;
    if (length > remaining) {
      numbered += content.slice(start, start + remaining);
      exceededBudget = true;
    } else {
      numbered += content.slice(start, end);
    }
  };

  let lineStart = firstLineStart;
  for (let line = firstLine; line <= lastLine; line += 1) {
    if (line > firstLine) appendText('\n');
    appendText(`${line}: `);
    const newline = content.indexOf('\n', lineStart);
    const rawLineEnd = newline < 0 ? content.length : newline;
    const lineEnd =
      rawLineEnd > lineStart && content.charCodeAt(rawLineEnd - 1) === 13
        ? rawLineEnd - 1
        : rawLineEnd;
    appendSource(lineStart, lineEnd);
    if (exceededBudget) break;
    lineStart = newline < 0 ? content.length : newline + 1;
  }
  if (numbered.length > available) exceededBudget = true;

  if (!exceededBudget) {
    return `${header}\n${numbered}`;
  }
  const bodyLimit = Math.max(0, available - suffix.length);
  return `${header}\n${numbered.slice(0, bodyLimit)}${suffix}`;
}

const AGENT_SYSTEM_PROMPT = `You are a senior product engineer operating an app-builder filesystem through an iterative tool loop.

Default stack: React 19, TypeScript, Vite, and CSS animations. Build polished, responsive, animated, and accessible applications. A new project must include package.json, index.html, tsconfig.json configured with "jsx": "react-jsx", src/main.tsx, src/App.tsx, and src/index.css. If you omit vite.config.ts, the tsconfig JSX setting is mandatory so Vite uses the automatic React runtime. Use smooth CSS transitions, hover animations, and keyframes for modern interactive feel. Do not use global prefers-reduced-motion rules with animation-duration: 0.01ms !important on * as it freezes watch hands, canvas loops, and clock movements.

Choose whichever behavior is useful at each turn. You may answer the user directly in plain text for quick chat, explanations, acknowledgements, or any request that does not require filesystem work. You may ask clarifying questions when useful. Thinking and filesystem actions are optional and may occur in any order. Work autonomously.

For a direct conversational answer, return the answer as normal plain text. When using tools, return one JSON action, a JSON array of actions, or multiple consecutive JSON action objects. Do not wrap them in markdown. Brief prose before tool actions is tolerated but not displayed.
{"type":"think","summary":"Planning the implementation","content":"A concise, user-visible explanation of the approach and next steps."}
{"type":"read_files","files":[{"path":"src/App.tsx","startLine":120,"endLine":220},{"path":"src/index.css"}]}
{"type":"write_file","path":"src/App.tsx","content":"complete file contents"}
{"type":"edit_file","path":"src/App.tsx","search":"exact unique existing text","replace":"replacement text"}
{"type":"delete_file","path":"src/obsolete.ts"}
{"type":"ask_questions","questions":[{"question":"Question?","options":["A","B","C"]}]}
{"type":"generate_images","images":[{"prompt":"Concise prompt","semanticUse":"hero-bg","placeholderToken":"__HERO_BG_IMG__"}]}
{"type":"propose_design_directions","directions":[{"title":"Title 1","visualBrief":"Brief 1","imagePrompt":"Hero prompt 1","palette":{"primary":"#0f172a","secondary":"#475569","background":"#ffffff","accent":"#3b82f6"},"typography":{"headingFont":"Inter","bodyFont":"Inter","styleNotes":"Clean"},"layoutNotes":"Hero layout"},{"title":"Title 2","visualBrief":"Brief 2","imagePrompt":"Hero prompt 2","palette":{"primary":"#18181b","secondary":"#71717a","background":"#09090b","accent":"#10b981"},"typography":{"headingFont":"Plus Jakarta Sans","bodyFont":"Plus Jakarta Sans","styleNotes":"Dark modern"},"layoutNotes":"Bento grid"},{"title":"Title 3","visualBrief":"Brief 3","imagePrompt":"Hero prompt 3","palette":{"primary":"#451a03","secondary":"#78350f","background":"#fffbeb","accent":"#d97706"},"typography":{"headingFont":"Playfair Display","bodyFont":"Lora","styleNotes":"Warm editorial"},"layoutNotes":"Minimalist"}]}
{"type":"respond","message":"Direct conversational answer with no filesystem changes."}
{"type":"finish","summary":"Short user-facing summary of the completed work."}
You may group independent read/write/edit/delete actions in one turn. They execute in order and every result is returned before your next turn.

Rules:
- Never claim to have read or changed a file unless the corresponding tool result confirms it.
- read_files accepts at most 12 file requests. Use {"path":"src/App.tsx"} for a complete file read, or add 1-indexed inclusive startLine and endLine fields to read only a specific range. Omit either bound to read from the beginning or through the end. Results include line numbers; use a narrow range when you only need one section and request another range when the result says it is truncated.
- write_file always contains the complete final file and creates or replaces it atomically.
- edit_file search text must occur exactly once.
- Paths are relative; never use .., leading slashes, backslashes, or NUL bytes.
- Do not emit source code anywhere except write_file content or edit_file search/replace.
- Keep thinking concise and safe to show directly to the user.
- "propose_design_directions" is only valid for an empty project. When files already exist, never propose a new visual direction or rebuild unrelated files; inspect and edit the existing application while preserving its current design unless the user explicitly requests a redesign. When proposing directions for an empty project, emit EXACTLY 3 distinct concepts and do NOT mutate project files in the same turn.
- When generating images, first inspect enough of the request and existing files to determine the complete visual asset inventory. Then issue one generate_images action containing one specification for every distinct image the website actually needs, at most 8 images per action and 16 per run. Reuse existing or selected-direction assets when suitable, wait for all image results before writing or editing files, and use only successful absolute asset URLs in source files. If a later pass discovers a genuinely new required asset, request only that asset in another generate_images action. Never write placeholder tokens for failed images.
- If request context indicates imageGeneration is unavailable, do not call image actions. Use CSS/neutral SVG placeholders instead.
- Use a direct plain-text response whenever no tool is needed. Finish only after a filesystem task is complete.
- If the user's message is a greeting, conversational query, or general question (such as "hii", "hello", "who are you?", "what can you do?"), DO NOT create or edit files or build an application. Use "respond" (or plain text) to reply conversationally and ask what application they would like to build.
- Only create, write, or modify project files when the user explicitly requests to build, generate, or modify an application or web page.`;

const NATIVE_TOOLS_SYSTEM_PROMPT = `You are a senior product engineer operating an app-builder filesystem through native tools.

Default stack: React 19, TypeScript, Vite, and CSS animations. Build polished, responsive, animated, and accessible applications. A new project must include package.json, index.html, tsconfig.json with "jsx": "react-jsx", src/main.tsx, src/App.tsx, and src/index.css. If you omit vite.config.ts, the tsconfig JSX setting is mandatory. Use semantic HTML, landmarks, labels, and alt text. Do not use global prefers-reduced-motion rules with animation-duration: 0.01ms !important on * as it freezes watch hands and canvas loops.

Call tools to read and change files. Reply with plain assistant text when no filesystem work is needed, or when the task is finished. Do not emit JSON tool syntax in the assistant message.

Rules:
- Never claim to have read or changed a file unless the corresponding tool result confirms it.
- read_files accepts at most 12 file requests. Results include line numbers.
- write_file always contains the complete final file.
- edit_file search text must occur exactly once.
- Paths are relative; never use .., leading slashes, backslashes, or NUL bytes.
- propose_design_directions is only valid for an empty project and must not mix with file mutations.
- generate_images: at most 8 images per call and 16 per run.
- If image generation is unavailable, use CSS/SVG placeholders.
- Greetings and general questions must not create files.`;

/**
 * Appended only when the calling client can execute `run` (it advertises the
 * WebContainer runtime). Appending it unconditionally would advertise a tool
 * the run cannot use, and a `run` call without a runtime is a wasted turn.
 * The JSON line is shown to text-protocol providers only — the native prompt
 * forbids JSON tool syntax in the assistant message.
 */
const RUNTIME_PROMPT_RULES = [
  `Sandbox verification ("run"):`,
  `- "run" executes ONE allowlisted command inside the project's browser sandbox and returns its combined stdout/stderr and exit code. Allowed commands: ${RUNTIME_COMMAND_NAMES.map((name) => `"${name}"`).join(', ')}. Nothing else can execute; never chain commands or add flags.`,
  `- Verify your work before finishing: run "npm install" after changing dependencies, then "npx tsc --noEmit" and "npx vite build". Fix every error the output reports, then run the command again until it is clean.`,
  `- Output is capped at 8000 characters. A "run error" (sandbox closed, timeout) is not a compile failure — do not rewrite working files to fix it; say the sandbox could not run the command.`,
].join('\n');

function buildAgentSystemPrompt(toolsOffered: boolean, runtimeEnabled: boolean): string {
  if (!runtimeEnabled) return toolsOffered ? NATIVE_TOOLS_SYSTEM_PROMPT : AGENT_SYSTEM_PROMPT;
  const rules = toolsOffered
    ? RUNTIME_PROMPT_RULES
    : `${RUNTIME_PROMPT_RULES}\n- {"type":"run","command":"npx tsc --noEmit"}`;
  return `${toolsOffered ? NATIVE_TOOLS_SYSTEM_PROMPT : AGENT_SYSTEM_PROMPT}\n\n${rules}`;
}

function parseProvider(value: string): AIProvider {
  const parsed = AIProvider.safeParse(value);
  if (!parsed.success) throw new Error(`Unsupported AI provider: ${value}`);
  return parsed.data;
}

/**
 * Serialize one SSE frame. The event name is pinned to the wire contract so a
 * producer cannot emit a frame the consumer's total `KNOWN_EVENT_TYPES` record
 * would silently drop — typing only the local `send` binding leaves this
 * serializer as an unchecked back door for any future direct caller.
 */
function encodeEvent(event: GenerationEvent['type'], data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function messageRecord(message: {
  id: string;
  role: string;
  content: string;
  timestamp: Date;
  model: string;
}) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    // The wire contract declares an ISO string. `JSON.stringify` produced the
    // same bytes from the Date, but emitting the string keeps the declared
    // type and the payload in agreement.
    timestamp: message.timestamp.toISOString(),
    model: message.model,
  };
}

/**
 * Authorize a project generation request and stream its progress and result as SSE.
 * Return HTTP errors for rejected requests and failed events for errors during generation.
 */
export async function POST(request: NextRequest) {
  const session = await getVerifiedSession();
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  // Capability handshake for the WebContainer bridge: only a client that
  // understands `runtime-request` may be offered the `run` tool. An older
  // client (or any non-browser caller) leaves the header off and the loop runs
  // exactly as before — `run` calls fail closed instead of stalling.
  const runtimeEnabled = request.headers.get('x-sovereign-runtime') === '1';

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const projectId = body.projectId?.trim();
  if (body.directionResponse && (!body.projectId || !body.modelProvider || !body.modelName)) {
    return Response.json(
      { error: 'Missing generation input for direction response' },
      { status: 400 },
    );
  }
  const prompt = body.message?.trim();
  if (
    !projectId ||
    (!prompt && !body.directionResponse) ||
    !body.modelProvider ||
    !body.modelName
  ) {
    return Response.json({ error: 'Missing generation input' }, { status: 400 });
  }

  const rate = await checkRateLimit('prompt', session.user.id);
  if (!rate.allowed) {
    const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
    return Response.json(
      { error: `Rate limit exceeded. Try again in ${retryIn}s.` },
      { status: 429 },
    );
  }

  const db = getDb();
  try {
    // Same authorization as every other project API (authz.ts): project owner,
    // explicit collaborator with EDITOR+, or org OWNER/ADMIN member (mapped to
    // project OWNER/EDITOR). The previous inline owner/collaborator check
    // silently 404'd org OWNER/ADMINs who can edit the same project through
    // the tRPC routers. All denials map to 404 so project existence stays
    // hidden from non-members.
    await requireProjectRole({ user: session.user, db }, projectId, 'EDITOR');
  } catch (error) {
    if (error instanceof TRPCError) {
      return Response.json({ error: 'Project not found' }, { status: 404 });
    }
    throw error;
  }
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      files: { orderBy: { path: 'asc' } },
    },
  });
  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });

  // Claim the generation lease. Two concurrent runs on one project would
  // interleave file writes (last write wins) and persist a mixed tree that
  // matches neither run, so the second caller is rejected outright.
  //
  // The claim is a conditional update, not a read-then-write, so it is atomic
  // across server instances. A lease whose heartbeat is older than
  // GENERATION_LEASE_STALE_MS belongs to a crashed run and is reclaimed. The
  // token identifies this run: only it may renew or release the lease, so a run
  // that aged out cannot free the lease of the run that replaced it.
  const leaseToken = randomUUID();
  const claimed = await tryClaimGenerationLease(db, projectId, leaseToken);
  if (!claimed) {
    return Response.json(
      {
        error:
          'A generation is already running for this project. Wait for it to finish or stop it first.',
        // Worst-case wait: a stale lease ages out after GENERATION_LEASE_STALE_MS
        // from its last heartbeat. The client can stop hammering the endpoint
        // and surface an actionable countdown instead of a bare 409.
        retryAfterMs: GENERATION_LEASE_STALE_MS,
      },
      { status: 409 },
    );
  }
  let leaseReleased = false;
  const releaseGenerationLease = async () => {
    if (leaseReleased) return;
    leaseReleased = true;
    try {
      await clearGenerationLease(db, projectId, leaseToken);
    } catch (error) {
      // Failing to release only blocks the project until the stale cutoff
      // passes; never mask the run's own outcome with this error.
      console.error('generate.lease_release_failed', error);
    }
  };

  /**
   * Fail after the lease was claimed. Every post-lease exit path must release
   * it, otherwise the project stays blocked until the stale cutoff passes.
   */
  const failWithLeaseReleased = async (body: unknown, status: number) => {
    await releaseGenerationLease();
    return Response.json(body, { status });
  };

  // Everything from here until the stream response is handed back is fallible:
  // key decryption, DB reads/writes and R2 configuration can all throw. Any
  // throw must release the lease, otherwise the project stays blocked until the
  // stale cutoff passes. Once the response is constructed the stream owns the
  // lease and releases it from its own `finally`.
  let leaseTransferredToStream = false;
  try {
    let providerName: AIProvider;
    try {
      providerName = parseProvider(body.modelProvider);
    } catch (error) {
      return failWithLeaseReleased(
        { error: error instanceof Error ? error.message : 'Invalid provider' },
        400,
      );
    }
    const storedKey = await db.apiKey.findFirst({
      where: { userId: session.user.id, provider: providerName },
    });
    if (!storedKey) {
      return failWithLeaseReleased({ error: `No API key configured for ${providerName}` }, 400);
    }
    const apiKey = decryptApiKey(storedKey.encryptedKey);
    const imageConfig = await db.imageProviderConfig.findFirst({
      where: { userId: session.user.id, enabled: true },
    });
    const r2Status = getR2ConfigStatus();
    // Image generation needs somewhere durable to put bytes. The local-disk
    // fallback is fine for local development but on a deployed (ephemeral)
    // filesystem the asset would vanish on the next deploy while its DB row
    // survived — so production requires real object storage.
    const isAssetStorageDurable = r2Status.isConfigured || process.env.NODE_ENV !== 'production';
    const isImageGenReady = Boolean(imageConfig && isAssetStorageDurable);

    const attachmentParts: string[] = [];
    let attachmentBytes = 0;
    for (const file of Array.isArray(body.files) ? body.files.slice(0, 10) : []) {
      const path = (file.path ?? '').trim().slice(0, 256);
      const content = file.content ?? '';
      if (!path || !content) continue;
      const contentBytes = Buffer.byteLength(content, 'utf8');
      if (contentBytes > 100 * 1024) continue;
      attachmentBytes += contentBytes;
      attachmentParts.push(`--- ${path} ---\n${content}`);
    }
    if (attachmentBytes > MAX_ATTACHMENT_BYTES) {
      return failWithLeaseReleased({ error: 'Attachments exceed 512 KB total' }, 400);
    }
    let effectivePrompt = prompt ?? '';
    if (body.directionResponse) {
      const { action, setId, directionId } = body.directionResponse;
      const directionSet = await db.designDirectionSet.findFirst({
        where: { id: setId, projectId },
        include: { directions: { include: { previewAsset: true } } },
      });
      if (!directionSet) {
        return failWithLeaseReleased({ error: 'Design direction set not found' }, 404);
      }

      if (action === 'select') {
        if (!directionId) return failWithLeaseReleased({ error: 'Missing directionId' }, 400);
        if (directionSet.status === 'selected') {
          return failWithLeaseReleased({ error: 'Design direction already selected' }, 400);
        }
        const selected = directionSet.directions.find((d) => d.id === directionId);
        if (!selected) {
          return failWithLeaseReleased({ error: 'Direction not found in set' }, 404);
        }

        await db.designDirectionSet.update({
          where: { id: setId },
          data: { status: 'selected', selectedDirectionId: directionId },
        });

        effectivePrompt = `[Selected Visual Direction: "${selected.title}"]\nVisual Brief: ${selected.visualBrief}\nPalette: ${JSON.stringify(selected.palette)}\nTypography: ${JSON.stringify(selected.typography)}\nLayout Notes: ${selected.layoutNotes}${selected.previewAsset?.publicUrl ? `\nHero Asset URL: ${selected.previewAsset.publicUrl}` : ''}\n\n${prompt ? `User Prompt: ${prompt}` : 'Apply the selected visual direction and construct the application.'}`;
      } else if (action === 'skip') {
        const readyDir = directionSet.directions.find((d) => d.status === 'ready');
        if (readyDir) {
          await db.designDirectionSet.update({
            where: { id: setId },
            data: { status: 'skipped', selectedDirectionId: readyDir.id },
          });
          effectivePrompt = `[Default Visual Direction: "${readyDir.title}"]\nVisual Brief: ${readyDir.visualBrief}\nPalette: ${JSON.stringify(readyDir.palette)}\nTypography: ${JSON.stringify(readyDir.typography)}\nLayout Notes: ${readyDir.layoutNotes}${readyDir.previewAsset?.publicUrl ? `\nHero Asset URL: ${readyDir.previewAsset.publicUrl}` : ''}\n\n${prompt ? `User Prompt: ${prompt}` : 'Apply the default visual direction and construct the application.'}`;
        } else {
          // No usable direction — fall back to a plain generation instead of
          // silently dropping the request.
          return failWithLeaseReleased(
            {
              error:
                'No ready design direction to skip to. Please regenerate or start a new request.',
            },
            400,
          );
        }
      } else if (action === 'regenerate') {
        // Re-open the set and instruct the agent to propose fresh directions.
        await db.designDirectionSet.update({
          where: { id: setId },
          data: { status: 'pending', selectedDirectionId: null },
        });
        effectivePrompt = `${prompt ? `User Prompt: ${prompt}\n\n` : ''}The previous design directions were not satisfactory. Propose 3 NEW and DIFFERENT design directions with propose_design_directions.`;
      }
    }

    const userMessage = await db.chatMessage.create({
      data: {
        projectId,
        role: 'user',
        content: prompt ?? '',
        model: `${providerName}:${body.modelName}`,
      },
    });
    // A runtime-enabled run persists a row so `run` tool calls can hang a
    // `GenerationToolTrace` off it — that trace is the shared state the SSE
    // waiter polls when the client's result POST lands on another instance.
    // Runs without the runtime capability do not pay for it.
    const generationRun = runtimeEnabled
      ? await db.generationRun.create({
          data: {
            projectId,
            userId: session.user.id,
            modelProvider: providerName,
            modelName: body.modelName,
            sourceMessageId: userMessage.id,
          },
        })
      : null;
    const history = await db.chatMessage.findMany({
      where: { projectId, id: { not: userMessage.id } },
      orderBy: { timestamp: 'desc' },
      take: 10,
      select: { role: true, content: true },
    });

    let stoppedByClient = false;
    const abortController = new AbortController();
    request.signal.addEventListener(
      'abort',
      () => {
        stoppedByClient = true;
        abortController.abort();
      },
      { once: true },
    );

    const isExistingProject = project.files.length > 0;

    /**
     * Terminal status for the persisted `GenerationRun` row (runtime-enabled
     * runs only). Best-effort: a failed bookkeeping update must never fail the
     * user's run. Defined before the stream so every exit path — including
     * setup failures — can settle the row.
     */
    const settleGenerationRun = async (
      status: 'SUCCEEDED' | 'FAILED' | 'CANCELED',
      tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number },
    ) => {
      if (!generationRun) return;
      try {
        await db.generationRun.update({
          where: { id: generationRun.id },
          data: { status, completedAt: new Date(), ...(tokenUsage ? { tokenUsage } : {}) },
        });
      } catch (error) {
        console.error('generate.run_settle_failed', error);
      }
    };

    const stream = new ReadableStream<Uint8Array>({
      /** Run the agent, emit progress events, and settle the run when the stream ends. */
      async start(controller) {
        // Typed against the wire contract: an event name or payload the
        // consumer does not declare is a compile error here, not a frame it
        // silently drops at runtime.
        const send: GenerationEventSink = (event, data) => {
          try {
            if (controller.desiredSize !== null) controller.enqueue(encodeEvent(event, data));
          } catch {
            // The client disconnected and the stream was closed or errored —
            // swallow so the agent loop can unwind instead of crashing it.
          }
        };
        // Declared before the try so the failure handler can still revert partial
        // streaming previews when setup throws before the agent loop starts.
        let activeProvisionalOriginals = new Map<string, string | null>();
        // Also declared before the try: the failure path settles the persisted
        // GenerationRun with whatever usage was accumulated before the error.
        let finalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        try {
          const files = new Map(project.files.map((file) => [file.path, file.content]));
          // Console errors the client captured from the preview iframe, attached
          // to this turn so the model can see a broken preview without having to
          // run a command first. Sanitized here: the value crosses the wire and
          // lands in the prompt.
          const turnRuntimeErrors = sanitizePreviewErrors(body.runtimeErrors);
          const provider = getProvider(providerName);
          const toolsOffered = nativeToolsEnabled(providerName);
          // OpenCode's gateway routes and caches per conversation and rejects
          // requests without a session id. Derive it from the project so every
          // turn of one conversation reuses the same id, without handing the
          // provider our raw internal identifier.
          const providerSessionId = createHash('sha256')
            .update(projectId)
            .digest('hex')
            .slice(0, 32);
          const messages: AgentMessage[] = [
            { role: 'system', content: buildAgentSystemPrompt(toolsOffered, runtimeEnabled) },
            ...history.reverse().map((message) => ({
              role: message.role === 'assistant' ? ('assistant' as const) : ('user' as const),
              content: message.content,
            })),
            {
              role: 'user',
              content: [
                `Project: ${project.name}`,
                project.description ? `Description: ${project.description}` : '',
                `Project state: ${isExistingProject ? 'EXISTING APPLICATION — preserve the current design and make only the requested changes.' : 'EMPTY PROJECT — create the application from the user request.'}`,
                `Current file manifest:\n${[...files.keys()].join('\n') || '(empty project)'}`,
                body.editTarget
                  ? `Selected visual element: ${JSON.stringify(body.editTarget)}`
                  : '',
                attachmentParts.length ? `Attachments:\n${attachmentParts.join('\n\n')}` : '',
                turnRuntimeErrors.length
                  ? `Preview console errors reported by the browser since the last message (may be stale; verify before "fixing"):\n${turnRuntimeErrors.map((line) => `- ${line}`).join('\n')}`
                  : '',
                `Image Generation Capability: ${isImageGenReady ? 'available' : 'unavailable'}${!isImageGenReady ? ` (Reason: ${!imageConfig ? 'Image provider not configured' : r2Status.reason})` : ''}`,
                `Request: ${effectivePrompt}`,
              ]
                .filter(Boolean)
                .join('\n\n'),
            },
          ];
          let latestVersion = 0;
          const runSteps: AgentStep[] = [];
          let consecutiveProtocolFailures = 0;
          let imagesGeneratedThisRun = 0;
          // Consecutive turns without filesystem progress. Always counted, but
          // only a configured SOVEREIGN_MAX_NO_PROGRESS stops the run: a BYOK
          // run is not cut off for thinking out loud or reading several files in
          // a row, and Stop remains the user's control.
          let consecutiveNoProgressIterations = 0;

          const emitStep = (step: AgentStep) => {
            const index = runSteps.findIndex((item) => item.id === step.id);
            if (index < 0) runSteps.push(step);
            else runSteps[index] = step;
            send('step', step);
          };
          // Answer text already sent to the live transcript bubble. `answer`
          // events carry a full snapshot rather than a delta, so the client only
          // ever replaces the bubble's text. It outlives one iteration: a turn
          // that streamed an answer and then continued (truncated completion,
          // unparseable action) must still be able to clear or replace it.
          let liveAnswerSnapshot = '';
          const updateLiveAnswer = (text: string) => {
            if (text === liveAnswerSnapshot) return;
            liveAnswerSnapshot = text;
            send('answer', { content: text });
          };
          // F-10: batch file mutations within one agent turn into a single
          // transaction + single version snapshot to avoid DB amplification.
          let pendingBatch: { change: VersionDiffEntry; step: AgentStep }[] = [];
          const flushPendingBatch = async () => {
            if (pendingBatch.length === 0) return;
            const batch = pendingBatch.splice(0);
            const persistable = batch.filter((b) => !isSovereignOverlayPath(b.change.file));
            if (persistable.length === 0) {
              const completedAt = new Date();
              for (const { step } of batch) {
                emitStep({
                  ...step,
                  status: 'complete',
                  completedAt: completedAt.toISOString(),
                  durationMs: completedAt.getTime() - new Date(step.startedAt).getTime(),
                });
              }
              return;
            }
            const changes = persistable.map((b) => b.change);
            const version = await db.$transaction(async (tx) => {
              // Lease guard: renewal is per-iteration, so between renewals a
              // reclaimed run can still reach this flush. Refuse to write the
              // moment ownership is gone — otherwise this run's file upserts
              // interleave with the replacement run's tree.
              if (!(await assertGenerationLeaseOwned(tx, projectId, leaseToken))) {
                throw new Error(
                  'This generation lost its project lock to another run, so it stopped to avoid interleaving writes.',
                );
              }
              for (const ch of changes) {
                if (ch.operation === 'delete') {
                  await tx.projectFile.deleteMany({ where: { projectId, path: ch.file } });
                } else {
                  const content = ch.after ?? '';
                  const contentHash = createHash('sha256').update(content).digest('hex');
                  await tx.projectFile.upsert({
                    where: { projectId_path: { projectId, path: ch.file } },
                    create: { projectId, path: ch.file, content, contentHash },
                    update: { content, contentHash },
                  });
                }
              }
              return createVersion(tx, projectId, null, changes);
            });
            latestVersion = version.versionNumber;
            const completedAt = new Date();
            for (const { step } of batch) {
              emitStep({
                ...step,
                status: 'complete',
                completedAt: completedAt.toISOString(),
                durationMs: completedAt.getTime() - new Date(step.startedAt).getTime(),
              });
            }
            for (const { change } of persistable) {
              send('file-operation', {
                // `VersionDiffEntry.operation` also allows 'restore' (version
                // timeline restores), which this endpoint never produces; to a
                // preview that would be an ordinary content write.
                operation: change.operation === 'restore' ? 'update' : change.operation,
                path: change.file,
                ...(change.after !== undefined ? { content: change.after } : {}),
                versionNumber: latestVersion,
              });
              activeProvisionalOriginals.delete(change.file);
            }
          };
          const persistAutofix = async (changes: StackContractChange[]) => {
            if (changes.length === 0) return;
            const versionDiffs: VersionDiffEntry[] = changes.map((ch) => ({
              file: ch.path,
              operation: ch.operation,
              ...(ch.before !== undefined ? { before: ch.before } : {}),
              ...(ch.content !== undefined ? { after: ch.content } : {}),
            }));
            const version = await db.$transaction(async (tx) => {
              // Lease guard, same as flushPendingBatch: an autofix batch must
              // never interleave with a replacement run's writes.
              if (!(await assertGenerationLeaseOwned(tx, projectId, leaseToken))) {
                throw new Error(
                  'This generation lost its project lock to another run, so it stopped to avoid interleaving writes.',
                );
              }
              for (const ch of changes) {
                if (ch.operation === 'delete') {
                  await tx.projectFile.deleteMany({ where: { projectId, path: ch.path } });
                } else {
                  const content = ch.content ?? '';
                  const contentHash = createHash('sha256').update(content).digest('hex');
                  await tx.projectFile.upsert({
                    where: { projectId_path: { projectId, path: ch.path } },
                    create: { projectId, path: ch.path, content, contentHash },
                    update: { content, contentHash },
                  });
                }
              }
              return createVersion(tx, projectId, null, versionDiffs, { message: 'autofix' });
            });
            latestVersion = version.versionNumber;
            for (const ch of changes) {
              send('file-operation', {
                operation: ch.operation,
                path: ch.path,
                ...(ch.content !== undefined ? { content: ch.content } : {}),
                versionNumber: latestVersion,
              });
            }
          };
          /**
           * Execute one `run` tool call through the client's WebContainer:
           * persist a pending trace row, emit `runtime-request`, block until the
           * client posts the result back (or the budget expires), persist the
           * outcome, and return the model-facing observation.
           */
          const executeRuntimeRun = async (request: {
            step: AgentStep;
            command: string;
            toolCallId: string;
          }): Promise<string> => {
            const spec = resolveRuntimeCommand(request.command);
            if (!spec) {
              return `run error: "${request.command}" is not an allowlisted command. Allowed commands: ${RUNTIME_COMMAND_NAMES.join(', ')}.`;
            }
            const requestId = randomUUID();
            const budgetMs = spec.timeoutMs + RUNTIME_RESULT_GRACE_MS;
            let traceId: string | null = null;
            try {
              const trace = await db.generationToolTrace.create({
                data: {
                  runId: generationRun!.id,
                  toolCallId: request.toolCallId,
                  name: 'run',
                  arguments: { command: spec.command } as never,
                  status: RUNTIME_TRACE_PENDING,
                  requestId,
                  command: spec.command,
                  timeoutMs: spec.timeoutMs,
                  expiresAt: new Date(Date.now() + budgetMs),
                },
              });
              traceId = trace.id;
            } catch (error) {
              // The row is the cross-instance channel; the in-process fast path
              // still resolves a same-instance POST, so keep going.
              console.error('generate.runtime_trace_create_failed', error);
            }
            send('runtime-request', {
              requestId,
              toolCallId: request.toolCallId,
              command: spec.command,
              timeoutMs: spec.timeoutMs,
            });
            const outcome = await waitForRuntimeResult({
              requestId,
              timeoutMs: budgetMs,
              signal: abortController.signal,
              // A `run` can wait minutes on one POST; without periodic bytes an
              // idle-timeout-happy proxy cuts the stream mid-`npm install`.
              onHeartbeat: () => send('runtime-heartbeat', { requestId }),
              loadTrace: async (id) => {
                const row = await db.generationToolTrace.findFirst({
                  where: { requestId: id },
                  select: { status: true, result: true },
                });
                return row;
              },
            });

            const emitRunStep = (
              step: AgentStep,
              status: 'complete' | 'failed',
              detail: string,
            ) => {
              const completedAt = new Date();
              emitStep({
                ...step,
                status,
                detail,
                completedAt: completedAt.toISOString(),
                durationMs: completedAt.getTime() - new Date(step.startedAt).getTime(),
              });
            };
            const updateTrace = async (status: string, result?: RuntimeCommandResult) => {
              if (!traceId) return;
              try {
                await db.generationToolTrace.update({
                  where: { id: traceId },
                  data: {
                    status,
                    ...(result ? { result: result as never, durationMs: result.durationMs } : {}),
                  },
                });
              } catch (error) {
                console.error('generate.runtime_trace_update_failed', error);
              }
            };

            if (outcome.kind !== 'result') {
              const aborted = outcome.kind === 'aborted';
              const message = aborted
                ? `run error: the run was stopped before \`${spec.command}\` returned a result.`
                : `run error: \`${spec.command}\` did not return a result within ${Math.round(budgetMs / 1000)}s. The preview sandbox may be closed or busy; this is not a compile failure.`;
              emitRunStep(
                request.step,
                'failed',
                aborted
                  ? 'The run was stopped.'
                  : `No result within ${Math.round(budgetMs / 1000)}s.`,
              );
              await updateTrace(aborted ? RUNTIME_TRACE_ABORTED : RUNTIME_TRACE_TIMEOUT);
              return message;
            }

            const result = outcome.result;
            emitRunStep(
              request.step,
              result.status === 'complete' ? 'complete' : 'failed',
              result.status === 'complete'
                ? `Exit code ${result.exitCode ?? 'unknown'} in ${(result.durationMs / 1000).toFixed(1)}s`
                : (result.error ?? 'The command could not run.'),
            );
            await updateTrace(result.status === 'complete' ? 'complete' : 'failed', result);
            return formatRuntimeObservation(spec.command, result);
          };
          const completeRun = async (content: string) => {
            const assistantMessage = await db.chatMessage.create({
              data: {
                projectId,
                role: 'assistant',
                content,
                model: `${providerName}:${body.modelName}`,
                tokenUsage: finalUsage,
                toolCalls: runSteps as never,
              },
            });
            await db.apiKey.update({
              where: { id: storedKey.id },
              data: { lastUsedAt: new Date() },
            });
            await settleGenerationRun('SUCCEEDED', finalUsage);
            send('ready', {
              userMessage: messageRecord(userMessage),
              assistantMessage: { ...messageRecord(assistantMessage), tokenUsage: finalUsage },
              files: [...files].map(([path, content]) => ({ path, content })),
              versionNumber: latestVersion,
            });
          };
          send('phase', { phase: 'planning', label: 'Starting agent' });
          for (
            let iteration = 0;
            MAX_ITERATIONS === undefined || iteration < MAX_ITERATIONS;
            iteration += 1
          ) {
            if (abortController.signal.aborted) throw new Error('Generation stopped');
            // Heartbeat the lease. It is only reclaimable once its timestamp
            // goes stale (20 min), and a long run can legitimately outlive that.
            // Renewal happens per iteration rather than on a timer, so a run
            // stuck between turns stops renewing and still ages out. Losing the
            // lease means another run took over: writing on would interleave two
            // runs' file writes, so stop instead.
            if (!(await renewGenerationLease(db, projectId, leaseToken))) {
              throw new Error(
                'This generation lost its project lock to another run, so it stopped to avoid interleaving writes.',
              );
            }
            const iterationStartedAt = new Date();
            const thinkingStepId = randomUUID();
            let responseContent = '';
            let reasoningContent = '';
            let streamedToolCalls: ToolCall[] = [];
            let truncatedThisTurn = false;
            let lastThinkingEmit = 0;
            let lastAnswerEmit = 0;
            let lastFilePreviewEmit = 0;
            let previewSignature = '';
            const provisionalOriginals = new Map<string, string | null>();
            activeProvisionalOriginals = provisionalOriginals;
            const provisionalSteps = new Map<string, AgentStep>();
            const thinkingStep: AgentStep = {
              id: thinkingStepId,
              kind: 'thinking',
              title: 'Thinking',
              detail: 'Analyzing the request…',
              status: 'running',
              startedAt: iterationStartedAt.toISOString(),
            };
            emitStep(thinkingStep);

            const generator = provider.stream(
              body.modelName!,
              trimMessagesForContext(messages),
              apiKey,
              {
                baseUrl: storedKey.baseUrl ?? undefined,
                sessionId: providerSessionId,
                // No artificial per-turn cap by default ("free" runs): the provider
                // uses its own maximum output length. Operators can still bound
                // spend with SOVEREIGN_MAX_TOKENS. Truncated outputs are continued
                // automatically (finishReason === 'length'), never treated as
                // failures.
                ...(TURN_MAX_TOKENS !== undefined ? { maxTokens: TURN_MAX_TOKENS } : {}),
                temperature: 0.2,
                reasoningEffort: body.reasoningEffort,
                signal: abortController.signal,
                ...(toolsOffered
                  ? {
                      tools: runtimeEnabled
                        ? [...SOVEREIGN_TOOLS, SOVEREIGN_RUNTIME_TOOL]
                        : SOVEREIGN_TOOLS,
                      toolChoice: 'auto' as const,
                    }
                  : {}),
              },
            );
            while (true) {
              const next = await generator.next();
              if (next.done) {
                responseContent = next.value.content || responseContent;
                if (next.value.reasoning) reasoningContent = next.value.reasoning;
                if (next.value.finishReason === 'length') truncatedThisTurn = true;
                if (next.value.toolCalls && next.value.toolCalls.length > 0) {
                  streamedToolCalls = next.value.toolCalls;
                }
                finalUsage = {
                  promptTokens: finalUsage.promptTokens + next.value.usage.promptTokens,
                  completionTokens: finalUsage.completionTokens + next.value.usage.completionTokens,
                  totalTokens: finalUsage.totalTokens + next.value.usage.totalTokens,
                };
                break;
              }
              responseContent += next.value.content;
              if (next.value.reasoning) reasoningContent += next.value.reasoning;
              if (next.value.finishReason === 'length') truncatedThisTurn = true;
              if (next.value.toolCalls && next.value.toolCalls.length > 0) {
                streamedToolCalls = next.value.toolCalls;
              }
              const streamedThought = reasoningContent || getStreamingThought(responseContent);
              if (streamedThought) {
                const now = Date.now();
                if (now - lastThinkingEmit >= 75) {
                  lastThinkingEmit = now;
                  emitStep({ ...thinkingStep, detail: streamedThought });
                  send('thinking', { content: streamedThought });
                }
              }
              // The transcript answer — a respond/finish field, or plain prose —
              // reaches the live bubble while the model writes it, so the chat
              // shows the same thing the collapsed reasoning panel is doing.
              // Deliberately not cleared when this returns null: the settle below
              // owns clearing text that turned out to belong to a tool turn, and
              // a mid-turn empty snapshot would blank the bubble for a frame.
              const streamedAnswer = getStreamingAnswer(responseContent);
              if (streamedAnswer !== null && streamedAnswer !== liveAnswerSnapshot) {
                const now = Date.now();
                if (now - lastAnswerEmit >= 75) {
                  lastAnswerEmit = now;
                  updateLiveAnswer(streamedAnswer);
                }
              }
              const streamedFile =
                getStreamingFileFromToolCalls(streamedToolCalls) ??
                getStreamingFileAction(responseContent);
              if (streamedFile) {
                const now = Date.now();
                const provisionalKey = `${streamedFile.type}:${streamedFile.path}`;
                if (!provisionalSteps.has(provisionalKey)) {
                  const provisionalStep: AgentStep = {
                    id: randomUUID(),
                    kind:
                      streamedFile.type === 'write_file' && !files.has(streamedFile.path)
                        ? 'write'
                        : 'edit',
                    title: `${streamedFile.type === 'write_file' && !files.has(streamedFile.path) ? 'Creating' : 'Editing'} ${streamedFile.path}`,
                    status: 'running',
                    startedAt: new Date().toISOString(),
                  };
                  provisionalSteps.set(provisionalKey, provisionalStep);
                  emitStep(provisionalStep);
                }
                let previewContent: string | null = null;
                let previewCursor: { line: number; column: number } | null = null;
                if (streamedFile.type === 'write_file') {
                  previewContent = streamedFile.content;
                  // Cursor at the end of the streamed content: the model is
                  // writing there right now.
                  previewCursor = cursorPositionAt(previewContent, previewContent.length);
                } else {
                  const existing = files.get(streamedFile.path);
                  if (existing !== undefined) {
                    try {
                      previewContent = applyAgentEdit(
                        existing,
                        streamedFile.search,
                        streamedFile.replace,
                      );
                      previewCursor = cursorPositionAt(
                        previewContent,
                        existing.indexOf(streamedFile.search) + streamedFile.replace.length,
                      );
                    } catch {
                      previewContent = null;
                    }
                  }
                }
                const signature =
                  previewContent === null
                    ? ''
                    : `${streamedFile.path}:${previewContent.length}:${previewCursor?.line}:${previewCursor?.column}`;
                if (
                  previewContent !== null &&
                  previewCursor !== null &&
                  signature !== previewSignature &&
                  now - lastFilePreviewEmit >= 75
                ) {
                  previewSignature = signature;
                  lastFilePreviewEmit = now;
                  if (!provisionalOriginals.has(streamedFile.path)) {
                    provisionalOriginals.set(
                      streamedFile.path,
                      files.get(streamedFile.path) ?? null,
                    );
                  }
                  send('file-preview', {
                    operation: files.has(streamedFile.path) ? 'update' : 'create',
                    path: streamedFile.path,
                    content: previewContent,
                    ...previewCursor,
                  });
                }
              }
            }
            // The provider cut the completion off at its token ceiling (either
            // SOVEREIGN_MAX_TOKENS or a provider-imposed limit). Parsing a
            // truncated action would fail; ask the model to finish the output in
            // the next turn — never counted as a protocol failure, but it does
            // count as a no-progress turn: a model whose every completion hits
            // the ceiling would otherwise loop forever, burning a BYOK key.
            if (truncatedThisTurn) {
              consecutiveNoProgressIterations += 1;
              if (consecutiveNoProgressIterations >= MAX_NO_PROGRESS_TURNS) {
                throw new Error(
                  `The agent hit the token limit ${consecutiveNoProgressIterations} turns in a row without making filesystem progress. ` +
                    `Raise SOVEREIGN_MAX_TOKENS or simplify the requested change.`,
                );
              }
              messages.push(
                streamedToolCalls.length > 0
                  ? { role: 'assistant', content: responseContent, toolCalls: streamedToolCalls }
                  : { role: 'assistant', content: responseContent },
              );
              if (streamedToolCalls.length > 0) {
                streamedToolCalls.forEach((call, index) => {
                  messages.push({
                    role: 'tool',
                    toolCallId: call.id || `call_${index}`,
                    content:
                      'error: the previous tool call was truncated at the token limit. Re-issue the complete call.',
                  });
                });
              } else {
                messages.push({
                  role: 'user',
                  content:
                    'Your previous output was cut off at the token limit. If you were writing a JSON action, output the COMPLETE valid JSON action now without repeating prose. Otherwise continue your previous message exactly where it stopped.',
                });
              }
              emitStep({
                ...thinkingStep,
                title: 'Output truncated — continuing',
                detail:
                  'The previous completion hit its token ceiling; asking the model to continue.',
                status: 'complete',
                completedAt: new Date().toISOString(),
                durationMs: Date.now() - iterationStartedAt.getTime(),
              });
              continue;
            }
            let action: AgentAction;
            const usedNativeToolCalls = toolsOffered && streamedToolCalls.length > 0;
            try {
              if (usedNativeToolCalls) {
                action = actionsFromToolCalls(streamedToolCalls);
              } else {
                const text = responseContent.trim();
                if (!text) {
                  // Reasoning models (DeepSeek/Kimi-style gateways) sometimes end
                  // a turn with only `reasoning_content` and empty `content`. That
                  // reasoning is already surfaced in the collapsed step; promoting
                  // it to the transcript would present internal thinking as the
                  // assistant's answer. Ask for real output instead, and let the
                  // no-progress guard bound a model that never produces any.
                  emitStep({
                    ...thinkingStep,
                    title: 'No user-facing output — asking again',
                    detail: reasoningContent.trim() || 'The model returned no output.',
                    status: 'complete',
                    completedAt: new Date().toISOString(),
                    durationMs: Date.now() - iterationStartedAt.getTime(),
                  });
                  messages.push({
                    role: 'user',
                    content:
                      'Your last turn produced no user-facing output. Emit the next action now, or a short user-facing reply via respond.',
                  });
                  consecutiveNoProgressIterations += 1;
                  if (consecutiveNoProgressIterations >= MAX_NO_PROGRESS_TURNS) {
                    throw new Error(
                      `The model produced no user-facing output after ${MAX_NO_PROGRESS_TURNS} turns.`,
                    );
                  }
                  continue;
                } else {
                  try {
                    action = parseAgentAction(text);
                  } catch {
                    // Prose is a valid agent answer, but an attempted structured
                    // action that fails to parse must not end the run as a chat
                    // reply — rethrow so the protocol-failure strike path below
                    // asks the model to re-emit it.
                    if (text.startsWith('{') || /\{\s*"type"\s*:/.test(text)) {
                      throw new Error('Model emitted an unparseable structured action');
                    }
                    action = { type: 'respond', message: text };
                  }
                }
              }
              const mutationPaths = getAgentFileMutationPaths(action);
              for (const path of provisionalOriginals.keys()) {
                if (!mutationPaths.has(path)) {
                  throw new Error(
                    `Streamed file edit for ${path} was not completed as a filesystem action`,
                  );
                }
              }
              consecutiveProtocolFailures = 0;
            } catch (error) {
              const completedAt = new Date();
              const message = error instanceof Error ? error.message : 'Invalid action format';
              // Not an answer: the turn is retried, and whatever the model wrote
              // first is either superseded by the retry or, after three strikes,
              // promoted by the fallback below.
              updateLiveAnswer('');
              for (const [path, original] of provisionalOriginals) {
                send(
                  'file-preview',
                  original === null
                    ? { operation: 'delete', path }
                    : { operation: 'update', path, content: original },
                );
              }
              for (const step of provisionalSteps.values()) {
                emitStep({
                  ...step,
                  status: 'failed',
                  detail: message,
                  completedAt: completedAt.toISOString(),
                  durationMs: completedAt.getTime() - new Date(step.startedAt).getTime(),
                });
              }
              if (usedNativeToolCalls && streamedToolCalls.length > 0) {
                // The model called a tool we cannot execute (unknown name or
                // malformed arguments). Feed each call back as a tool error —
                // exactly like a real harness — so the model corrects itself
                // instead of the run aborting after retries.
                emitStep({
                  ...thinkingStep,
                  title: 'Tool call rejected',
                  detail: message,
                  status: 'failed',
                  completedAt: completedAt.toISOString(),
                  durationMs: completedAt.getTime() - iterationStartedAt.getTime(),
                });
                messages.push({
                  role: 'assistant',
                  content: responseContent,
                  toolCalls: streamedToolCalls,
                });
                streamedToolCalls.forEach((call, index) => {
                  messages.push({
                    role: 'tool',
                    toolCallId: call.id || `call_${index}`,
                    content: `error: could not execute "${call.function.name}": ${message}. Only use the tools listed in the system prompt and re-issue the corrected call.`,
                  });
                });
                consecutiveProtocolFailures = 0;
                continue;
              }
              consecutiveProtocolFailures += 1;
              if (consecutiveProtocolFailures >= 3) {
                // Never hard-fail a run over formatting: surface whatever the
                // model produced as a normal reply so the user can steer the
                // next turn.
                const fallbackText =
                  responseContent.trim() ||
                  'I could not format that step as an action. What should I try instead?';
                if (responseContent.trim().length > 0) {
                  messages.push({ role: 'assistant', content: responseContent });
                }
                updateLiveAnswer(fallbackText);
                emitStep({
                  ...thinkingStep,
                  title: 'Completing with a plain answer',
                  detail: message,
                  status: 'complete',
                  completedAt: completedAt.toISOString(),
                  durationMs: completedAt.getTime() - iterationStartedAt.getTime(),
                });
                await completeRun(fallbackText);
                return;
              }
              emitStep({
                ...thinkingStep,
                title: 'Retrying action',
                detail: message,
                status: 'failed',
                completedAt: completedAt.toISOString(),
                durationMs: completedAt.getTime() - iterationStartedAt.getTime(),
              });
              messages.push({ role: 'assistant', content: responseContent });
              messages.push({
                role: 'user',
                content: `The action could not be parsed: ${message}. Correct the format and continue. Do not explain the formatting error to the user.`,
              });
              continue;
            }
            messages.push(
              usedNativeToolCalls
                ? { role: 'assistant', content: responseContent, toolCalls: streamedToolCalls }
                : { role: 'assistant', content: responseContent },
            );
            const startedAt = iterationStartedAt;
            // The turn settled, so the streamed bubble is replaced by the exact
            // text this run will persist — or cleared when the turn was a tool
            // call, matching the prompt's "prose before tool actions is not
            // displayed". Placed before the `think` branch so a thinking turn
            // cannot leave its prose prefix on screen.
            updateLiveAnswer(getSettledAnswer(action) ?? '');

            if (action.type === 'think') {
              const completedAt = new Date();
              emitStep({
                ...thinkingStep,
                title: action.summary,
                detail: action.content,
                status: 'complete',
                completedAt: completedAt.toISOString(),
                durationMs: completedAt.getTime() - startedAt.getTime(),
              });
              messages.push({
                role: 'user',
                content: 'Thinking recorded. Choose whichever action is useful next.',
              });
              // `think` makes no filesystem progress — count it so a model stuck
              // emitting only think/respond cannot spin the loop forever.
              consecutiveNoProgressIterations += 1;
              if (consecutiveNoProgressIterations >= MAX_NO_PROGRESS_TURNS) {
                throw new Error(
                  `The agent made no filesystem progress after ${MAX_NO_PROGRESS_TURNS} turns.`,
                );
              }
              continue;
            }

            const thinkingCompletedAt = new Date();
            emitStep({
              ...thinkingStep,
              title: 'Chose next action',
              detail: reasoningContent || 'Selected the next useful action.',
              status: 'complete',
              completedAt: thinkingCompletedAt.toISOString(),
              durationMs: thinkingCompletedAt.getTime() - startedAt.getTime(),
            });
            const actions = action.type === 'batch' ? action.actions : [action];
            const actionGuardError = getDesignDirectionActionError(action, isExistingProject);
            if (actionGuardError) {
              const completedAt = new Date();
              for (const [path, original] of provisionalOriginals) {
                send(
                  'file-preview',
                  original === null
                    ? { operation: 'delete', path }
                    : { operation: 'update', path, content: original },
                );
              }
              for (const step of provisionalSteps.values()) {
                emitStep({
                  ...step,
                  status: 'failed',
                  detail: actionGuardError,
                  completedAt: completedAt.toISOString(),
                  durationMs: completedAt.getTime() - new Date(step.startedAt).getTime(),
                });
              }
              emitStep({
                ...thinkingStep,
                title: 'Blocked unsafe action',
                detail: actionGuardError,
                status: 'complete',
                completedAt: completedAt.toISOString(),
                durationMs: completedAt.getTime() - startedAt.getTime(),
              });
              if (usedNativeToolCalls && streamedToolCalls.length > 0) {
                streamedToolCalls.forEach((call, index) => {
                  messages.push({
                    role: 'tool',
                    toolCallId: call.id || `call_${index}`,
                    content: `error: ${actionGuardError}`,
                  });
                });
              } else {
                messages.push({
                  role: 'user',
                  content: `Action blocked: ${actionGuardError} Continue by reading and editing only the files needed for the user's request.`,
                });
              }
              consecutiveNoProgressIterations += 1;
              if (consecutiveNoProgressIterations >= MAX_NO_PROGRESS_TURNS) {
                throw new Error(
                  `The agent repeatedly attempted an unsafe design-direction action (${MAX_NO_PROGRESS_TURNS} turns).`,
                );
              }
              continue;
            }
            const toolResults: string[] = [];
            // `run` actions execute after this turn's file mutations are flushed
            // to the sandbox (just below), so a command always compiles the bytes
            // the model just wrote. `index` is the slot in `toolResults` the
            // observation lands in, keeping results aligned with tool calls.
            const runRequests: {
              index: number;
              step: AgentStep;
              command: string;
              toolCallId: string;
            }[] = [];
            let handledFilesystemAction = false;
            let handledFilesystemMutation = false;
            const askQuestionsAction = actions.find(
              (a): a is Extract<AgentAction, { type: 'ask_questions' }> =>
                a.type === 'ask_questions',
            );
            const respondAction = actions.find(
              (a): a is Extract<AgentAction, { type: 'respond' }> => a.type === 'respond',
            );
            const finishAction = actions.find(
              (a): a is Extract<AgentAction, { type: 'finish' }> => a.type === 'finish',
            );
            for (const [actionIndex, currentAction] of actions.entries()) {
              const currentStepId = randomUUID();
              const actionStartedAt = new Date();
              if (currentAction.type === 'read_files') {
                handledFilesystemAction = true;
                const detail = currentAction.files
                  .map((request) => {
                    const range =
                      request.startLine !== undefined || request.endLine !== undefined
                        ? ` (${request.startLine ?? 1}-${request.endLine ?? 'EOF'})`
                        : ' (full)';
                    return `${request.path}${range}`;
                  })
                  .join('\n');
                const step: AgentStep = {
                  id: currentStepId,
                  kind: 'read',
                  title: `Reading ${currentAction.files.length} file${currentAction.files.length === 1 ? '' : 's'}`,
                  detail,
                  status: 'running',
                  startedAt: actionStartedAt.toISOString(),
                };
                emitStep(step);
                let remainingBudget = MAX_READ_RESULT_CHARS;
                const observations = currentAction.files
                  .map((request) => {
                    const observation = formatReadObservation(
                      request.path,
                      files.get(request.path),
                      request,
                      remainingBudget,
                    );
                    remainingBudget = Math.max(0, remainingBudget - observation.length - 2);
                    return observation;
                  })
                  .join('\n\n');
                const completedAt = new Date();
                emitStep({
                  ...step,
                  status: 'complete',
                  completedAt: completedAt.toISOString(),
                  durationMs: completedAt.getTime() - actionStartedAt.getTime(),
                });
                toolResults.push(`read_files result:\n${observations}`);
                continue;
              }
              if (currentAction.type === 'write_file') {
                handledFilesystemAction = true;
                if (isForbiddenEnvPath(currentAction.path)) {
                  toolResults.push(
                    `write_file error: refused to write ${currentAction.path}. Use .env.example with VITE_* keys only.`,
                  );
                  continue;
                }
                handledFilesystemMutation = true;
                const existed = files.has(currentAction.path);
                const before = files.get(currentAction.path);
                const step = provisionalSteps.get(`write_file:${currentAction.path}`) ?? {
                  id: currentStepId,
                  kind: existed ? 'edit' : 'write',
                  title: `${existed ? 'Writing' : 'Creating'} ${currentAction.path}`,
                  status: 'running' as const,
                  startedAt: actionStartedAt.toISOString(),
                };
                if (!provisionalSteps.has(`write_file:${currentAction.path}`)) emitStep(step);
                files.set(currentAction.path, currentAction.content);
                pendingBatch.push({
                  change: {
                    file: currentAction.path,
                    operation: existed ? 'update' : 'create',
                    ...(before !== undefined ? { before } : {}),
                    after: currentAction.content,
                  },
                  step,
                });
                toolResults.push(
                  `write_file result: wrote ${currentAction.path} (${currentAction.content.length} characters).`,
                );
                continue;
              }
              if (currentAction.type === 'edit_file') {
                handledFilesystemAction = true;
                if (isForbiddenEnvPath(currentAction.path)) {
                  toolResults.push(
                    `edit_file error: refused to write ${currentAction.path}. Use .env.example with VITE_* keys only.`,
                  );
                  continue;
                }
                handledFilesystemMutation = true;
                const before = files.get(currentAction.path);
                if (before === undefined) {
                  toolResults.push(
                    `edit_file error: ${currentAction.path} does not exist. Use write_file to create it.`,
                  );
                  continue;
                }
                const step = provisionalSteps.get(`edit_file:${currentAction.path}`) ?? {
                  id: currentStepId,
                  kind: 'edit' as const,
                  title: `Editing ${currentAction.path}`,
                  status: 'running' as const,
                  startedAt: actionStartedAt.toISOString(),
                };
                if (!provisionalSteps.has(`edit_file:${currentAction.path}`)) emitStep(step);
                try {
                  const after = applyAgentEdit(before, currentAction.search, currentAction.replace);
                  files.set(currentAction.path, after);
                  pendingBatch.push({
                    change: { file: currentAction.path, operation: 'update', before, after },
                    step,
                  });
                  toolResults.push(`edit_file result: updated ${currentAction.path}.`);
                } catch (error) {
                  const completedAt = new Date();
                  const message = error instanceof Error ? error.message : 'Edit failed';
                  emitStep({
                    ...step,
                    status: 'failed',
                    detail: message,
                    completedAt: completedAt.toISOString(),
                    durationMs: completedAt.getTime() - actionStartedAt.getTime(),
                  });
                  toolResults.push(
                    `edit_file error: ${message}. Read the file again before retrying.`,
                  );
                }
                continue;
              }
              if (currentAction.type === 'delete_file') {
                handledFilesystemAction = true;
                handledFilesystemMutation = true;
                const before = files.get(currentAction.path);
                if (before === undefined) {
                  toolResults.push(`delete_file result: ${currentAction.path} was already absent.`);
                  continue;
                }
                const step: AgentStep = {
                  id: currentStepId,
                  kind: 'delete',
                  title: `Deleting ${currentAction.path}`,
                  status: 'running',
                  startedAt: actionStartedAt.toISOString(),
                };
                emitStep(step);
                files.delete(currentAction.path);
                pendingBatch.push({
                  change: { file: currentAction.path, operation: 'delete', before },
                  step,
                });
                toolResults.push(`delete_file result: deleted ${currentAction.path}.`);
              }
              if (currentAction.type === 'run') {
                handledFilesystemAction = true;
                const step: AgentStep = {
                  id: currentStepId,
                  kind: 'verify',
                  title: `Running ${currentAction.command}`,
                  detail: 'Executing in the preview sandbox',
                  status: 'running',
                  startedAt: actionStartedAt.toISOString(),
                };
                emitStep(step);
                if (!runtimeEnabled) {
                  // Fail closed: the client never advertised the WebContainer
                  // bridge, so no runtime-request would ever be answered.
                  const completedAt = new Date();
                  emitStep({
                    ...step,
                    status: 'failed',
                    detail: 'This client cannot execute sandbox commands.',
                    completedAt: completedAt.toISOString(),
                    durationMs: completedAt.getTime() - actionStartedAt.getTime(),
                  });
                  toolResults.push(
                    'run error: the sandbox runtime is unavailable for this run (the client did not advertise WebContainer support). Do not call run again; continue with file actions and tell the user the command could not be executed.',
                  );
                  continue;
                }
                // Deferred: the command must see the files this turn writes, so
                // it runs after the batch below is flushed to the sandbox.
                runRequests.push({
                  index: toolResults.length,
                  step,
                  command: currentAction.command,
                  toolCallId: streamedToolCalls[actionIndex]?.id ?? currentStepId,
                });
                // Placeholder keeps toolResults aligned with the tool calls that
                // produced them; the run fills it in after the flush.
                toolResults.push('');
                continue;
              }
              if (currentAction.type === 'generate_images') {
                if (imagesGeneratedThisRun + currentAction.images.length > MAX_IMAGES_PER_RUN) {
                  toolResults.push(
                    `generate_images error: this run already used ${imagesGeneratedThisRun} of ${MAX_IMAGES_PER_RUN} images. Do not request more images.`,
                  );
                  continue;
                }
                imagesGeneratedThisRun += currentAction.images.length;
                const imageResults = await mapWithConcurrency(
                  currentAction.images,
                  IMAGE_GENERATION_CONCURRENCY,
                  async (spec) => {
                    const jobId = randomUUID();
                    const step: AgentStep = {
                      id: jobId,
                      kind: 'image',
                      title: `Generating image: ${spec.semanticUse}`,
                      detail: spec.prompt,
                      status: 'running',
                      startedAt: new Date().toISOString(),
                    };
                    emitStep(step);
                    send('image-job', {
                      id: jobId,
                      status: 'running',
                      semanticUse: spec.semanticUse,
                      prompt: spec.prompt,
                      placeholderToken: spec.placeholderToken,
                    });

                    try {
                      if (!isImageGenReady || !imageConfig) {
                        throw new Error('Image generation is unavailable');
                      }
                      const decryptedKey = decryptApiKey(imageConfig.encryptedKey);
                      let lastError: unknown;
                      for (let attempt = 1; attempt <= 2; attempt += 1) {
                        try {
                          const imgRes = await generateImage(
                            imageConfig.model,
                            spec.prompt,
                            decryptedKey,
                            {
                              baseUrl: imageConfig.baseUrl,
                              signal: abortController.signal,
                              timeoutMs: 120_000,
                            },
                          );
                          const asset = await uploadProjectAsset({
                            projectId,
                            createdById: session.user.id,
                            bytes: imgRes.bytes,
                            mediaType: imgRes.mediaType,
                            prompt: spec.prompt,
                            source: 'generated',
                          });
                          await db.imageProviderConfig.update({
                            where: { id: imageConfig.id },
                            data: { lastUsedAt: new Date() },
                          });
                          const completedAt = new Date();
                          emitStep({
                            ...step,
                            status: 'complete',
                            completedAt: completedAt.toISOString(),
                            durationMs: completedAt.getTime() - new Date(step.startedAt).getTime(),
                          });
                          send('image-job', {
                            id: jobId,
                            status: 'complete',
                            publicUrl: asset.publicUrl,
                            assetId: asset.id,
                            placeholderToken: spec.placeholderToken,
                          });
                          return `${spec.semanticUse}: ${asset.publicUrl}`;
                        } catch (error) {
                          lastError = error;
                          if (abortController.signal.aborted) throw error;
                          if (!isRetryableImageError(error)) break;
                        }
                      }
                      throw lastError;
                    } catch (error) {
                      const completedAt = new Date();
                      const message =
                        error instanceof Error ? error.message : 'Image generation failed';
                      emitStep({
                        ...step,
                        status: 'failed',
                        detail: message,
                        completedAt: completedAt.toISOString(),
                        durationMs: completedAt.getTime() - new Date(step.startedAt).getTime(),
                      });
                      send('image-job', {
                        id: jobId,
                        status: 'failed',
                        error: message,
                        placeholderToken: spec.placeholderToken,
                      });
                      return `${spec.semanticUse}: FAILED (${message})`;
                    }
                  },
                );
                toolResults.push(
                  `generate_images result:\n${imageResults.join('\n')}\nUse only the successful absolute URLs in source files. Do not write placeholder tokens for failed images.`,
                );
                handledFilesystemAction = true;
                handledFilesystemMutation = true;
              }
              if (currentAction.type === 'propose_design_directions') {
                // Supersede any older pending sets so `getActive` returns the newest.
                await db.designDirectionSet.updateMany({
                  where: { projectId, status: 'pending' },
                  data: { status: 'skipped' },
                });

                const directionSet = await db.designDirectionSet.create({
                  data: {
                    projectId,
                    originalRequest: prompt ?? '',
                    status: 'pending',
                    directions: {
                      create: currentAction.directions.map((d, idx) => ({
                        orderNumber: idx,
                        title: d.title,
                        visualBrief: d.visualBrief,
                        imagePrompt: d.imagePrompt,
                        palette: d.palette,
                        typography: d.typography,
                        layoutNotes: d.layoutNotes,
                        status: 'generating',
                      })),
                    },
                  },
                  include: { directions: { orderBy: { orderNumber: 'asc' } } },
                });

                send('design-directions', {
                  id: directionSet.id,
                  status: 'pending',
                  originalRequest: prompt ?? '',
                  directions: directionSet.directions as DesignDirectionRecord[],
                });

                const dirStep: AgentStep = {
                  id: randomUUID(),
                  kind: 'direction',
                  title: 'Proposing 3 design directions',
                  detail: 'Generating preview moodboards for concepts',
                  status: 'running',
                  startedAt: new Date().toISOString(),
                };
                emitStep(dirStep);

                const settled = await Promise.allSettled(
                  directionSet.directions.map(async (dir) => {
                    if (!isImageGenReady || !imageConfig) return null;
                    try {
                      const decryptedKey = decryptApiKey(imageConfig.encryptedKey);
                      const imgRes = await generateImage(
                        imageConfig.model,
                        dir.imagePrompt,
                        decryptedKey,
                        {
                          baseUrl: imageConfig.baseUrl,
                          signal: abortController.signal,
                        },
                      );
                      const asset = await uploadProjectAsset({
                        projectId,
                        createdById: session.user.id,
                        bytes: imgRes.bytes,
                        mediaType: imgRes.mediaType,
                        prompt: dir.imagePrompt,
                        source: 'generated',
                      });
                      await db.designDirection.update({
                        where: { id: dir.id },
                        data: { status: 'ready', previewAssetId: asset.id },
                      });
                      return { directionId: dir.id, assetId: asset.id, publicUrl: asset.publicUrl };
                    } catch (err) {
                      await db.designDirection.update({
                        where: { id: dir.id },
                        data: {
                          status: 'failed',
                          errorMessage:
                            err instanceof Error ? err.message : 'Preview generation failed',
                        },
                      });
                      return null;
                    }
                  }),
                );

                // If no direction ended up ready, the set is unusable — mark it failed
                // so the UI can show a clear state instead of a set of broken cards.
                const readyCount = settled.filter(
                  (r) => r.status === 'fulfilled' && r.value !== null,
                ).length;
                const setStatus = readyCount > 0 ? 'ready' : 'failed';

                await db.designDirectionSet.update({
                  where: { id: directionSet.id },
                  data: { status: setStatus },
                });

                const updatedSet = await db.designDirectionSet.findUnique({
                  where: { id: directionSet.id },
                  include: {
                    directions: {
                      orderBy: { orderNumber: 'asc' },
                      include: { previewAsset: true },
                    },
                  },
                });

                const completedAt = new Date();
                emitStep({
                  ...dirStep,
                  status: setStatus === 'ready' ? 'complete' : 'failed',
                  detail:
                    setStatus === 'ready'
                      ? 'Generating preview moodboards for concepts'
                      : 'All design previews failed to generate',
                  completedAt: completedAt.toISOString(),
                  durationMs: completedAt.getTime() - new Date(dirStep.startedAt).getTime(),
                });

                send('design-directions', {
                  id: directionSet.id,
                  status: setStatus,
                  originalRequest: prompt ?? '',
                  directions: (updatedSet?.directions ?? []) as DesignDirectionRecord[],
                });

                const assistantMsg = await db.chatMessage.create({
                  data: {
                    projectId,
                    role: 'assistant',
                    content: 'Proposed 3 design directions for user selection.',
                    model: `${providerName}:${body.modelName}`,
                    tokenUsage: finalUsage,
                    toolCalls: runSteps as never,
                  },
                });

                send('ready', {
                  userMessage: messageRecord(userMessage),
                  assistantMessage: { ...messageRecord(assistantMsg), tokenUsage: finalUsage },
                  files: [...files].map(([p, c]) => ({ path: p, content: c })),
                  versionNumber: latestVersion,
                });
                await settleGenerationRun('SUCCEEDED', finalUsage);
                return;
              }
            }
            // F-10: commit all buffered file mutations of this turn together
            let autofixNote: string | null = null;
            if (pendingBatch.length > 0) {
              await flushPendingBatch();
              try {
                const autofix = applyStackContract(files);
                if (autofix.changes.length > 0) {
                  await persistAutofix(autofix.changes);
                  files.clear();
                  for (const [path, content] of autofix.files) files.set(path, content);
                  autofixNote = autofix.syntheticToolResult;
                }
              } catch (error) {
                console.error('generate.autofix_skipped', error);
                autofixNote = 'autofix skipped: contract checker failed after files were saved.';
              }
            }
            // Runs execute here — after `flushPendingBatch` emitted the
            // `file-operation` events, so the client has already applied this
            // turn's writes when it spawns the command.
            for (const request of runRequests) {
              toolResults[request.index] = await executeRuntimeRun(request);
            }
            if (handledFilesystemMutation) {
              consecutiveNoProgressIterations = 0;
            } else if (!askQuestionsAction && !respondAction && !finishAction) {
              consecutiveNoProgressIterations += 1;
              if (consecutiveNoProgressIterations >= MAX_NO_PROGRESS_TURNS) {
                throw new Error(
                  `The agent made no filesystem progress after ${MAX_NO_PROGRESS_TURNS} turns.`,
                );
              }
            }

            if (handledFilesystemAction) {
              if (usedNativeToolCalls) {
                streamedToolCalls.forEach((call, index) => {
                  messages.push({
                    role: 'tool',
                    toolCallId: call.id || `call_${index}`,
                    content: toolResults[index] ?? toolResults.join('\n\n'),
                  });
                });
                if (autofixNote) {
                  const last = messages[messages.length - 1];
                  if (last?.role === 'tool') last.content = `${last.content}\n\n${autofixNote}`;
                }
              } else {
                if (autofixNote) toolResults.push(autofixNote);
                messages.push({ role: 'user', content: toolResults.join('\n\n') });
              }
              if (!askQuestionsAction && !respondAction && !finishAction) {
                continue;
              }
            }

            if (askQuestionsAction) {
              const content = askQuestionsAction.questions
                .map((item, index) => `${index + 1}. ${item.question}`)
                .join('\n');
              const assistantMessage = await db.chatMessage.create({
                data: {
                  projectId,
                  role: 'assistant',
                  content,
                  model: `${providerName}:${body.modelName}`,
                  toolCalls: runSteps as never,
                },
              });
              send('questions', {
                questions: askQuestionsAction.questions,
                userMessage: messageRecord(userMessage),
                assistantMessage: messageRecord(assistantMessage),
              });
              await settleGenerationRun('SUCCEEDED', finalUsage);
              return;
            }
            if (respondAction) {
              await completeRun(respondAction.message);
              return;
            }
            if (finishAction) {
              await completeRun(finishAction.summary);
              return;
            }
          }
          // Only reachable when an operator set SOVEREIGN_MAX_ITERATIONS: an
          // uncapped loop always exits through return/throw above.
          throw new Error(
            MAX_ITERATIONS === undefined
              ? 'The agent loop ended without a terminal action.'
              : `Agent exceeded ${MAX_ITERATIONS} steps without finishing`,
          );
        } catch (error) {
          for (const [path, original] of activeProvisionalOriginals) {
            send(
              'file-preview',
              original === null
                ? { operation: 'delete', path }
                : { operation: 'update', path, content: original },
            );
          }
          if (stoppedByClient) {
            send('failed', { message: 'Generation stopped. Completed changes were kept.' });
          } else {
            send('failed', {
              message: error instanceof Error ? error.message : 'Agent run failed',
              // Lets the client pick an accurate headline instead of assuming
              // every provider failure is a bad API key. Only local refusals
              // may identify themselves as loopback policy failures.
              code:
                error instanceof ProviderError &&
                (error.status === 0 || error.code !== 'loopback_blocked')
                  ? error.code
                  : undefined,
            });
          }
          await settleGenerationRun(stoppedByClient ? 'CANCELED' : 'FAILED', finalUsage);
        } finally {
          // The run is over (finished, failed, or aborted) — free the project for
          // the next generation.
          await releaseGenerationLease();
          try {
            controller.close();
          } catch {
            // Stream already closed or errored (e.g. client disconnect).
          }
        }
      },
    });

    const response = new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
    // From here on the stream owns the lease and releases it in its own
    // `finally`; the outer handler must not release it early.
    leaseTransferredToStream = true;
    return response;
  } finally {
    if (!leaseTransferredToStream) {
      await releaseGenerationLease();
    }
  }
}
