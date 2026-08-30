import { createHash, randomUUID } from 'node:crypto';
import { getServerSession } from 'next-auth';
import { NextRequest } from 'next/server';
import { getProvider, generateImage, ProviderError } from '@app-builder/ai-gateway';
import { uploadProjectAsset } from '@/server/assets/project-assets';
import { getR2ConfigStatus } from '@/server/assets/r2';
import { AIProvider } from '@app-builder/shared';
import { authOptions } from '@/lib/auth';
import { decryptApiKey } from '@/lib/crypto';
import { getDb } from '@/lib/db';
import { applyAgentEdit, getAgentFileMutationPaths, getDesignDirectionActionError, getStreamingFileAction, getStreamingThought, parseAgentAction, MAX_IMAGES_PER_RUN, type AgentAction, type AgentReadRequest, type AgentStep } from '@/lib/agent-protocol';
import {
  SOVEREIGN_TOOLS,
  actionsFromToolCalls,
  getStreamingFileFromToolCalls,
  nativeToolsEnabled,
} from '@/lib/agent-tools';
import type { ToolCall } from '@app-builder/ai-gateway';
import { trimMessagesForContext, type AgentMessage } from '@/lib/context-window';
import { createVersion, type VersionDiffEntry } from '@/lib/versioning';
import { checkRateLimit } from '@/server/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface GenerateBody {
  projectId?: string;
  message?: string;
  modelProvider?: string;
  modelName?: string;
  files?: { path?: string; content?: string }[];
  reasoningEffort?: string;
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

const MAX_ITERATIONS = 40;
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

  const lines = content.split(/\r?\n/);
  const firstLine = request.startLine ?? 1;
  const requestedLastLine = request.endLine ?? lines.length;
  if (firstLine > lines.length) {
    return `--- ${path} (lines ${firstLine}-${requestedLastLine}) ---\n[line range is outside the file; file has ${lines.length} lines]`;
  }

  const lastLine = Math.min(requestedLastLine, lines.length);
  const header = request.startLine === undefined && request.endLine === undefined
    ? `--- ${path} (full file, lines 1-${lines.length}) ---`
    : `--- ${path} (lines ${firstLine}-${lastLine}) ---`;
  const numbered = lines
    .slice(firstLine - 1, lastLine)
    .map((line, index) => `${firstLine + index}: ${line}`)
    .join('\n');
  const suffix = '\n… [read output truncated; request a smaller line range]';
  const available = Math.max(0, budget - header.length - 1);
  if (numbered.length <= available) {
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

function buildAgentSystemPrompt(toolsOffered: boolean): string {
  return toolsOffered ? NATIVE_TOOLS_SYSTEM_PROMPT : AGENT_SYSTEM_PROMPT;
}

function parseProvider(value: string): AIProvider {
  const parsed = AIProvider.safeParse(value);
  if (!parsed.success) throw new Error(`Unsupported AI provider: ${value}`);
  return parsed.data;
}

function encodeEvent(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function messageRecord(message: { id: string; role: string; content: string; timestamp: Date; model: string }) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    timestamp: message.timestamp,
    model: message.model,
  };
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const projectId = body.projectId?.trim();
  if (body.directionResponse && (!body.projectId || !body.modelProvider || !body.modelName)) {
    return Response.json({ error: 'Missing generation input for direction response' }, { status: 400 });
  }
  const prompt = body.message?.trim();
  if (!projectId || (!prompt && !body.directionResponse) || !body.modelProvider || !body.modelName) {
    return Response.json({ error: 'Missing generation input' }, { status: 400 });
  }

  const rate = await checkRateLimit('prompt', session.user.id);
  if (!rate.allowed) {
    const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
    return Response.json({ error: `Rate limit exceeded. Try again in ${retryIn}s.` }, { status: 429 });
  }

  const db = getDb();
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      collaborators: { where: { userId: session.user.id }, select: { role: true } },
      files: { orderBy: { path: 'asc' } },
    },
  });
  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });
  const callerRole = project.ownerId === session.user.id ? 'OWNER' : (project.collaborators[0]?.role ?? null);
  if (callerRole !== 'OWNER' && callerRole !== 'EDITOR') {
    return Response.json({ error: 'Project not found' }, { status: 404 });
  }

  let providerName: AIProvider;
  try {
    providerName = parseProvider(body.modelProvider);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invalid provider' }, { status: 400 });
  }
  const storedKey = await db.apiKey.findFirst({ where: { userId: session.user.id, provider: providerName } });
  if (!storedKey) return Response.json({ error: `No API key configured for ${providerName}` }, { status: 400 });
  const apiKey = decryptApiKey(storedKey.encryptedKey);
  const imageConfig = await db.imageProviderConfig.findFirst({ where: { userId: session.user.id, enabled: true } });
  const r2Status = getR2ConfigStatus();
  const isImageGenReady = Boolean(imageConfig && r2Status.isConfigured);

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
    return Response.json({ error: 'Attachments exceed 512 KB total' }, { status: 400 });
  }
  let effectivePrompt = prompt ?? '';
  if (body.directionResponse) {
    const { action, setId, directionId } = body.directionResponse;
    const directionSet = await db.designDirectionSet.findFirst({
      where: { id: setId, projectId },
      include: { directions: { include: { previewAsset: true } } },
    });
    if (!directionSet) {
      return Response.json({ error: 'Design direction set not found' }, { status: 404 });
    }

    if (action === 'select') {
      if (!directionId) return Response.json({ error: 'Missing directionId' }, { status: 400 });
      if (directionSet.status === 'selected') {
        return Response.json({ error: 'Design direction already selected' }, { status: 400 });
      }
      const selected = directionSet.directions.find((d) => d.id === directionId);
      if (!selected) return Response.json({ error: 'Direction not found in set' }, { status: 404 });

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
        return Response.json(
          { error: 'No ready design direction to skip to. Please regenerate or start a new request.' },
          { status: 400 },
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
    data: { projectId, role: 'user', content: prompt ?? '', model: `${providerName}:${body.modelName}` },
  });
  const history = await db.chatMessage.findMany({
    where: { projectId, id: { not: userMessage.id } },
    orderBy: { timestamp: 'desc' },
    take: 10,
    select: { role: true, content: true },
  });

  let stoppedByClient = false;
  const abortController = new AbortController();
  request.signal.addEventListener('abort', () => {
    stoppedByClient = true;
    abortController.abort();
  }, { once: true });

  const isExistingProject = project.files.length > 0;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          if (controller.desiredSize !== null) controller.enqueue(encodeEvent(event, data));
        } catch {
          // The client disconnected and the stream was closed or errored —
          // swallow so the agent loop can unwind instead of crashing it.
        }
      };
      const files = new Map(project.files.map((file) => [file.path, file.content]));
      const provider = getProvider(providerName);
      const toolsOffered = nativeToolsEnabled(providerName);
      const messages: AgentMessage[] = [
        { role: 'system', content: buildAgentSystemPrompt(toolsOffered) },
        ...history.reverse().map((message) => ({
          role: message.role === 'assistant' ? 'assistant' as const : 'user' as const,
          content: message.content,
        })),
        {
          role: 'user',
          content: [
            `Project: ${project.name}`,
            project.description ? `Description: ${project.description}` : '',
            `Project state: ${isExistingProject ? 'EXISTING APPLICATION — preserve the current design and make only the requested changes.' : 'EMPTY PROJECT — create the application from the user request.'}`,
            `Current file manifest:\n${[...files.keys()].join('\n') || '(empty project)'}`,
            body.editTarget ? `Selected visual element: ${JSON.stringify(body.editTarget)}` : '',
            attachmentParts.length ? `Attachments:\n${attachmentParts.join('\n\n')}` : '',
            `Image Generation Capability: ${isImageGenReady ? 'available' : 'unavailable'}${!isImageGenReady ? ` (Reason: ${!imageConfig ? 'Image provider not configured' : r2Status.reason})` : ''}`,
            `Request: ${effectivePrompt}`,
          ].filter(Boolean).join('\n\n'),
        },
      ];
      let latestVersion = 0;
      let finalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      const runSteps: AgentStep[] = [];
      let consecutiveProtocolFailures = 0;
      let imagesGeneratedThisRun = 0;
      // Tracks how many consecutive turns made no filesystem progress. Prevents a
      // model that emits `think`/`respond` (or any valid non-mutating action)
      // forever from running the loop to MAX_ITERATIONS and burning tokens.
      let consecutiveNoProgressIterations = 0;
      let activeProvisionalOriginals = new Map<string, string | null>();

      const emitStep = (step: AgentStep) => {
        const index = runSteps.findIndex((item) => item.id === step.id);
        if (index < 0) runSteps.push(step);
        else runSteps[index] = step;
        send('step', step);
      };
      // F-10: batch file mutations within one agent turn into a single
      // transaction + single version snapshot to avoid DB amplification.
      let pendingBatch: { change: VersionDiffEntry; step: AgentStep }[] = [];
      const flushPendingBatch = async () => {
        if (pendingBatch.length === 0) return;
        const batch = pendingBatch.splice(0);
        const changes = batch.map((b) => b.change);
        const version = await db.$transaction(async (tx) => {
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
          emitStep({ ...step, status: 'complete', completedAt: completedAt.toISOString(), durationMs: completedAt.getTime() - new Date(step.startedAt).getTime() });
        }
        for (const { change } of batch) {
          send('file-operation', {
            operation: change.operation,
            path: change.file,
            ...(change.after !== undefined ? { content: change.after } : {}),
            versionNumber: latestVersion,
          });
          activeProvisionalOriginals.delete(change.file);
        }
      };
      try {
        send('phase', { phase: 'planning', label: 'Starting agent' });
        for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
          if (abortController.signal.aborted) throw new Error('Generation stopped');
          const iterationStartedAt = new Date();
          const thinkingStepId = randomUUID();
          let responseContent = '';
          let reasoningContent = '';
          let streamedToolCalls: ToolCall[] = [];
          let lastThinkingEmit = 0;
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

          const generator = provider.stream(body.modelName!, trimMessagesForContext(messages), apiKey, {
            baseUrl: storedKey.baseUrl ?? undefined,
            maxTokens: 32_000,
            temperature: 0.2,
            reasoningEffort: body.reasoningEffort,
            signal: abortController.signal,
            ...(toolsOffered
              ? { tools: SOVEREIGN_TOOLS, toolChoice: 'auto' as const }
              : {}),
          });
          while (true) {
            const next = await generator.next();
            if (next.done) {
              responseContent = next.value.content || responseContent;
              if (next.value.reasoning) reasoningContent = next.value.reasoning;
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
            const streamedFile =
              getStreamingFileFromToolCalls(streamedToolCalls) ?? getStreamingFileAction(responseContent);
            if (streamedFile) {
              const now = Date.now();
              const provisionalKey = `${streamedFile.type}:${streamedFile.path}`;
              if (!provisionalSteps.has(provisionalKey)) {
                const provisionalStep: AgentStep = {
                  id: randomUUID(),
                  kind: streamedFile.type === 'write_file' && !files.has(streamedFile.path) ? 'write' : 'edit',
                  title: `${streamedFile.type === 'write_file' && !files.has(streamedFile.path) ? 'Creating' : 'Editing'} ${streamedFile.path}`,
                  status: 'running',
                  startedAt: new Date().toISOString(),
                };
                provisionalSteps.set(provisionalKey, provisionalStep);
                emitStep(provisionalStep);
              }
              let previewContent: string | null = null;
              if (streamedFile.type === 'write_file') {
                previewContent = streamedFile.content;
              } else {
                const existing = files.get(streamedFile.path);
                if (existing !== undefined) {
                  try {
                    previewContent = applyAgentEdit(existing, streamedFile.search, streamedFile.replace);
                  } catch {
                    previewContent = null;
                  }
                }
              }
              const signature = previewContent === null ? '' : `${streamedFile.path}:${previewContent.length}`;
              if (previewContent !== null && signature !== previewSignature && now - lastFilePreviewEmit >= 75) {
                previewSignature = signature;
                lastFilePreviewEmit = now;
                if (!provisionalOriginals.has(streamedFile.path)) {
                  provisionalOriginals.set(streamedFile.path, files.get(streamedFile.path) ?? null);
                }
                send('file-preview', {
                  operation: files.has(streamedFile.path) ? 'update' : 'create',
                  path: streamedFile.path,
                  content: previewContent,
                });
              }
            }
          }
          let action: AgentAction;
          const usedNativeToolCalls = toolsOffered && streamedToolCalls.length > 0;
          try {
            if (usedNativeToolCalls) {
              action = actionsFromToolCalls(streamedToolCalls);
            } else if (toolsOffered) {
              const text = responseContent.trim();
              if (!text) {
                action = { type: 'finish', summary: reasoningContent.trim() || 'Done.' };
              } else {
                try {
                  action = parseAgentAction(text);
                } catch {
                  action = { type: 'respond', message: text };
                }
              }
            } else {
              action = parseAgentAction(responseContent);
            }
            const mutationPaths = getAgentFileMutationPaths(action);
            for (const path of provisionalOriginals.keys()) {
              if (!mutationPaths.has(path)) {
                throw new Error(`Streamed file edit for ${path} was not completed as a filesystem action`);
              }
            }
            consecutiveProtocolFailures = 0;
          } catch (error) {
            consecutiveProtocolFailures += 1;
            const completedAt = new Date();
            const message = error instanceof Error ? error.message : 'Invalid action format';
            for (const [path, original] of provisionalOriginals) {
              send('file-preview', original === null
                ? { operation: 'delete', path }
                : { operation: 'update', path, content: original });
            }
            for (const step of provisionalSteps.values()) {
              emitStep({ ...step, status: 'failed', detail: message, completedAt: completedAt.toISOString(), durationMs: completedAt.getTime() - new Date(step.startedAt).getTime() });
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
            messages.push({ role: 'user', content: `The action could not be parsed: ${message}. Correct the format and continue. Do not explain the formatting error to the user.` });
            if (consecutiveProtocolFailures >= 3) throw new Error('The selected model could not produce a valid agent action after three retries.');
            continue;
          }
          messages.push(
            usedNativeToolCalls
              ? { role: 'assistant', content: responseContent, toolCalls: streamedToolCalls }
              : { role: 'assistant', content: responseContent },
          );
          const startedAt = iterationStartedAt;

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
            messages.push({ role: 'user', content: 'Thinking recorded. Choose whichever action is useful next.' });
            // `think` makes no filesystem progress — count it so a model stuck
            // emitting only think/respond can't burn MAX_ITERATIONS of tokens.
            consecutiveNoProgressIterations += 1;
            if (consecutiveNoProgressIterations >= 5) {
              throw new Error('The agent made no filesystem progress after five turns.');
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
              send('file-preview', original === null
                ? { operation: 'delete', path }
                : { operation: 'update', path, content: original });
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
            messages.push({
              role: 'user',
              content: `Action blocked: ${actionGuardError} Continue by reading and editing only the files needed for the user's request.`,
            });
            consecutiveNoProgressIterations += 1;
            if (consecutiveNoProgressIterations >= 5) {
              throw new Error('The agent repeatedly attempted an unsafe design-direction action.');
            }
            continue;
          }
          const toolResults: string[] = [];
          let handledFilesystemAction = false;
          let handledFilesystemMutation = false;
          const askQuestionsAction = actions.find((a): a is Extract<AgentAction, { type: 'ask_questions' }> => a.type === 'ask_questions');
          const respondAction = actions.find((a): a is Extract<AgentAction, { type: 'respond' }> => a.type === 'respond');
          const finishAction = actions.find((a): a is Extract<AgentAction, { type: 'finish' }> => a.type === 'finish');
          for (const currentAction of actions) {
            const currentStepId = randomUUID();
            const actionStartedAt = new Date();
            if (currentAction.type === 'read_files') {
              handledFilesystemAction = true;
              const detail = currentAction.files
                .map((request) => {
                  const range = request.startLine !== undefined || request.endLine !== undefined
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
              const observations = currentAction.files.map((request) => {
                const observation = formatReadObservation(request.path, files.get(request.path), request, remainingBudget);
                remainingBudget = Math.max(0, remainingBudget - observation.length - 2);
                return observation;
              }).join('\n\n');
              const completedAt = new Date();
              emitStep({ ...step, status: 'complete', completedAt: completedAt.toISOString(), durationMs: completedAt.getTime() - actionStartedAt.getTime() });
              toolResults.push(`read_files result:\n${observations}`);
              continue;
            }
            if (currentAction.type === 'write_file') {
              handledFilesystemAction = true;
              handledFilesystemMutation = true;
              const existed = files.has(currentAction.path);
              const before = files.get(currentAction.path);
              const step = provisionalSteps.get(`write_file:${currentAction.path}`) ?? { id: currentStepId, kind: existed ? 'edit' : 'write', title: `${existed ? 'Writing' : 'Creating'} ${currentAction.path}`, status: 'running' as const, startedAt: actionStartedAt.toISOString() };
              if (!provisionalSteps.has(`write_file:${currentAction.path}`)) emitStep(step);
              files.set(currentAction.path, currentAction.content);
              pendingBatch.push({ change: { file: currentAction.path, operation: existed ? 'update' : 'create', ...(before !== undefined ? { before } : {}), after: currentAction.content }, step });
              toolResults.push(`write_file result: wrote ${currentAction.path} (${currentAction.content.length} characters).`);
              continue;
            }
            if (currentAction.type === 'edit_file') {
              handledFilesystemAction = true;
              handledFilesystemMutation = true;
              const before = files.get(currentAction.path);
              if (before === undefined) {
                toolResults.push(`edit_file error: ${currentAction.path} does not exist. Use write_file to create it.`);
                continue;
              }
              const step = provisionalSteps.get(`edit_file:${currentAction.path}`) ?? { id: currentStepId, kind: 'edit' as const, title: `Editing ${currentAction.path}`, status: 'running' as const, startedAt: actionStartedAt.toISOString() };
              if (!provisionalSteps.has(`edit_file:${currentAction.path}`)) emitStep(step);
              try {
                const after = applyAgentEdit(before, currentAction.search, currentAction.replace);
                files.set(currentAction.path, after);
                pendingBatch.push({ change: { file: currentAction.path, operation: 'update', before, after }, step });
                toolResults.push(`edit_file result: updated ${currentAction.path}.`);
              } catch (error) {
                const completedAt = new Date();
                const message = error instanceof Error ? error.message : 'Edit failed';
                emitStep({ ...step, status: 'failed', detail: message, completedAt: completedAt.toISOString(), durationMs: completedAt.getTime() - actionStartedAt.getTime() });
                toolResults.push(`edit_file error: ${message}. Read the file again before retrying.`);
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
              const step: AgentStep = { id: currentStepId, kind: 'delete', title: `Deleting ${currentAction.path}`, status: 'running', startedAt: actionStartedAt.toISOString() };
              emitStep(step);
              files.delete(currentAction.path);
              pendingBatch.push({ change: { file: currentAction.path, operation: 'delete', before }, step });
              toolResults.push(`delete_file result: deleted ${currentAction.path}.`);
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
                        const imgRes = await generateImage(imageConfig.model, spec.prompt, decryptedKey, {
                          baseUrl: imageConfig.baseUrl,
                          signal: abortController.signal,
                          timeoutMs: 120_000,
                        });
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
                    const message = error instanceof Error ? error.message : 'Image generation failed';
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
                directions: directionSet.directions,
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
                    const imgRes = await generateImage(imageConfig.model, dir.imagePrompt, decryptedKey, {
                      baseUrl: imageConfig.baseUrl,
                      signal: abortController.signal,
                    });
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
                        errorMessage: err instanceof Error ? err.message : 'Preview generation failed',
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
                directions: updatedSet?.directions ?? [],
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
                assistantMessage: messageRecord(assistantMsg),
                files: [...files].map(([p, c]) => ({ path: p, content: c })),
                versionNumber: latestVersion,
              });
              return;
            }
          }
          // F-10: commit all buffered file mutations of this turn together
          if (pendingBatch.length > 0) await flushPendingBatch();
          if (handledFilesystemMutation) {
            consecutiveNoProgressIterations = 0;
          } else if (!askQuestionsAction && !respondAction && !finishAction) {
            consecutiveNoProgressIterations += 1;
            if (consecutiveNoProgressIterations >= 5) {
              throw new Error('The agent made no filesystem progress after five turns.');
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
            } else {
              messages.push({ role: 'user', content: toolResults.join('\n\n') });
            }
            if (!askQuestionsAction && !respondAction && !finishAction) {
              continue;
            }
          }

          if (askQuestionsAction) {
            const content = askQuestionsAction.questions.map((item, index) => `${index + 1}. ${item.question}`).join('\n');
            const assistantMessage = await db.chatMessage.create({ data: { projectId, role: 'assistant', content, model: `${providerName}:${body.modelName}`, toolCalls: runSteps as never } });
            send('questions', { questions: askQuestionsAction.questions, userMessage: messageRecord(userMessage), assistantMessage: messageRecord(assistantMessage) });
            return;
          }
          if (respondAction) {
            const assistantMessage = await db.chatMessage.create({
              data: {
                projectId,
                role: 'assistant',
                content: respondAction.message,
                model: `${providerName}:${body.modelName}`,
                tokenUsage: finalUsage,
                toolCalls: runSteps as never,
              },
            });
            await db.apiKey.update({ where: { id: storedKey.id }, data: { lastUsedAt: new Date() } });
            send('ready', {
              userMessage: messageRecord(userMessage),
              assistantMessage: { ...messageRecord(assistantMessage), tokenUsage: finalUsage },
              files: [...files].map(([path, content]) => ({ path, content })),
              versionNumber: latestVersion,
            });
            return;
          }
          if (finishAction) {
            const assistantMessage = await db.chatMessage.create({
              data: {
                projectId,
                role: 'assistant',
                content: finishAction.summary,
                model: `${providerName}:${body.modelName}`,
                tokenUsage: finalUsage,
                toolCalls: runSteps as never,
              },
            });
            await db.apiKey.update({ where: { id: storedKey.id }, data: { lastUsedAt: new Date() } });
            send('ready', {
              userMessage: messageRecord(userMessage),
              assistantMessage: { ...messageRecord(assistantMessage), tokenUsage: finalUsage },
              files: [...files].map(([path, content]) => ({ path, content })),
              versionNumber: latestVersion,
            });
            return;
          }
        }
        throw new Error(`Agent exceeded ${MAX_ITERATIONS} steps without finishing`);
      } catch (error) {
        for (const [path, original] of activeProvisionalOriginals) {
          send('file-preview', original === null
            ? { operation: 'delete', path }
            : { operation: 'update', path, content: original });
        }
        if (stoppedByClient) {
          send('failed', { message: 'Generation stopped. Completed changes were kept.' });
        } else {
          send('failed', { message: error instanceof Error ? error.message : 'Agent run failed' });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Stream already closed or errored (e.g. client disconnect).
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
