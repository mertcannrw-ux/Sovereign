import { createHash, randomUUID } from 'node:crypto';
import { getProvider, generateImage, ProviderError, type ToolCall } from '@app-builder/ai-gateway';
import {
  applyStackContract,
  isForbiddenEnvPath,
  type StackContractChange,
} from '@app-builder/codegen';
import { TRPCError } from '@trpc/server';
import { resolveNoProgressGuard, resolveOptionalLimit } from '@/lib/agent-limits';
import { uploadProjectAsset } from '@/server/assets/project-assets';
import { getR2ConfigStatus } from '@/server/assets/r2';
import type { AIProvider } from '@app-builder/shared';
import { decryptApiKey } from '@/lib/crypto';
import { getDb } from '@/lib/db';
import { requireProjectAccess } from '@/server/authz';
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
  type AgentStep,
} from '@/lib/agent-protocol';
import {
  SOVEREIGN_RUNTIME_TOOL,
  SOVEREIGN_TOOLS,
  actionsFromToolCalls,
  getStreamingFileFromToolCalls,
  nativeToolsEnabled,
} from '@/lib/agent-tools';
import type { DesignDirectionRecord, GenerationEventSink } from '@/lib/generation-stream';
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
import { isSovereignOverlayPath } from '@/lib/preview-startup';
import type { AgentExecutionParams, AgentStreamResult } from './types';
import { parseProvider, MAX_ATTACHMENT_BYTES } from './validation';
import { buildAgentSystemPrompt, formatReadObservation, MAX_READ_RESULT_CHARS } from './prompts';
import { encodeEvent, messageRecord, createAsyncQueue } from './events';

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

export async function createAgentStream(params: AgentExecutionParams): Promise<AgentStreamResult> {
  const { user, body, runtimeEnabled, signal: externalSignal } = params;
  const projectId = body.projectId?.trim();
  if (!projectId) {
    return { ok: false, status: 400, body: { error: 'Missing generation input' } };
  }

  const prompt = body.message?.trim();
  const db = getDb();

  try {
    await requireProjectAccess({ user, db }, projectId);
  } catch (error) {
    if (error instanceof TRPCError) {
      return { ok: false, status: 404, body: { error: 'Project not found' } };
    }
    throw error;
  }

  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      files: { orderBy: { path: 'asc' } },
    },
  });
  if (!project) {
    return { ok: false, status: 404, body: { error: 'Project not found' } };
  }

  const leaseToken = randomUUID();
  const claimed = await tryClaimGenerationLease(db, projectId, leaseToken);
  if (!claimed) {
    return {
      ok: false,
      status: 409,
      body: {
        error:
          'A generation is already running for this project. Wait for it to finish or stop it first.',
        retryAfterMs: GENERATION_LEASE_STALE_MS,
      },
    };
  }

  let leaseReleased = false;
  const releaseGenerationLease = async () => {
    if (leaseReleased) return;
    leaseReleased = true;
    try {
      await clearGenerationLease(db, projectId, leaseToken);
    } catch (error) {
      console.error('generate.lease_release_failed', error);
    }
  };

  const failWithLeaseReleased = async (
    errBody: { error: string; retryAfterMs?: number },
    status: number,
  ): Promise<AgentStreamResult> => {
    await releaseGenerationLease();
    return { ok: false, status, body: errBody };
  };

  let leaseTransferredToStream = false;
  try {
    let providerName: AIProvider;
    try {
      providerName = parseProvider(body.modelProvider ?? '');
    } catch (error) {
      return await failWithLeaseReleased(
        { error: error instanceof Error ? error.message : 'Invalid provider' },
        400,
      );
    }

    // Builds use the project Realm's keys, whoever asked for the build.
    const storedKey = await db.apiKey.findFirst({
      where: { realmId: project.realmId, provider: providerName },
      orderBy: { createdAt: 'desc' },
    });
    if (!storedKey) {
      return await failWithLeaseReleased(
        {
          error: `This Realm has no ${providerName} key. An owner or admin can add one in Settings.`,
        },
        400,
      );
    }

    const apiKey = decryptApiKey(storedKey.encryptedKey);
    const imageConfig = await db.imageProviderConfig.findFirst({
      where: { realmId: project.realmId, enabled: true },
    });
    const r2Status = getR2ConfigStatus();
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
      return await failWithLeaseReleased({ error: 'Attachments exceed 512 KB total' }, 400);
    }

    let effectivePrompt = prompt ?? '';
    if (body.directionResponse) {
      const { action, setId, directionId } = body.directionResponse;
      const directionSet = await db.designDirectionSet.findFirst({
        where: { id: setId, projectId },
        include: { directions: { include: { previewAsset: true } } },
      });
      if (!directionSet) {
        return await failWithLeaseReleased({ error: 'Design direction set not found' }, 404);
      }

      if (action === 'select') {
        if (!directionId) {
          return await failWithLeaseReleased({ error: 'Missing directionId' }, 400);
        }
        if (directionSet.status === 'selected') {
          return await failWithLeaseReleased({ error: 'Design direction already selected' }, 400);
        }
        const selected = directionSet.directions.find((d) => d.id === directionId);
        if (!selected) {
          return await failWithLeaseReleased({ error: 'Direction not found in set' }, 404);
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
          return await failWithLeaseReleased(
            {
              error:
                'No ready design direction to skip to. Please regenerate or start a new request.',
            },
            400,
          );
        }
      } else if (action === 'regenerate') {
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

    const generationRun = runtimeEnabled
      ? await db.generationRun.create({
          data: {
            projectId,
            userId: user.id,
            modelProvider: providerName,
            modelName: body.modelName!,
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

    const abortController = new AbortController();
    let stoppedByClient = false;
    if (externalSignal) {
      if (externalSignal.aborted) {
        stoppedByClient = true;
        abortController.abort();
      } else {
        externalSignal.addEventListener(
          'abort',
          () => {
            stoppedByClient = true;
            abortController.abort();
          },
          { once: true },
        );
      }
    }

    const isExistingProject = project.files.length > 0;

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

    const maxIterations = resolveOptionalLimit(process.env.SOVEREIGN_MAX_ITERATIONS);
    const maxNoProgressTurns = resolveNoProgressGuard(process.env.SOVEREIGN_MAX_NO_PROGRESS);
    const turnMaxTokens =
      Number(process.env.SOVEREIGN_MAX_TOKENS) > 0
        ? Math.floor(Number(process.env.SOVEREIGN_MAX_TOKENS))
        : undefined;

    const runExecution = async function* (): AsyncGenerator<Uint8Array> {
      const queue = createAsyncQueue<Uint8Array>();

      const runLoop = async () => {
        const send: GenerationEventSink = (event, data) => {
          try {
            queue.push(encodeEvent(event, data));
          } catch {
            // Client stream closed
          }
        };

        let activeProvisionalOriginals = new Map<string, string | null>();
        let finalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

        try {
          const files = new Map(project.files.map((file) => [file.path, file.content]));
          const turnRuntimeErrors = sanitizePreviewErrors(body.runtimeErrors);
          const provider = getProvider(providerName);
          const toolsOffered = nativeToolsEnabled(providerName);
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
                `Project state: ${isExistingProject ? 'EXISTING APPLICATION - preserve the current design and make only the requested changes.' : 'EMPTY PROJECT - create the application from the user request.'}`,
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
          let consecutiveNoProgressIterations = 0;

          const emitStep = (step: AgentStep) => {
            const index = runSteps.findIndex((item) => item.id === step.id);
            if (index < 0) runSteps.push(step);
            else runSteps[index] = step;
            send('step', step);
          };

          let liveAnswerSnapshot = '';
          const updateLiveAnswer = (text: string) => {
            if (text === liveAnswerSnapshot) return;
            liveAnswerSnapshot = text;
            send('answer', { content: text });
          };

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
              files: [...files].map(([p, c]) => ({ path: p, content: c })),
              versionNumber: latestVersion,
            });
          };

          send('phase', { phase: 'planning', label: 'Starting agent' });

          for (
            let iteration = 0;
            maxIterations === undefined || iteration < maxIterations;
            iteration += 1
          ) {
            if (abortController.signal.aborted) throw new Error('Generation stopped');

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
                ...(turnMaxTokens !== undefined ? { maxTokens: turnMaxTokens } : {}),
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

            if (truncatedThisTurn) {
              consecutiveNoProgressIterations += 1;
              if (consecutiveNoProgressIterations >= maxNoProgressTurns) {
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
                title: 'Output truncated - continuing',
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
                  emitStep({
                    ...thinkingStep,
                    title: 'No user-facing output - asking again',
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
                  if (consecutiveNoProgressIterations >= maxNoProgressTurns) {
                    throw new Error(
                      `The model produced no user-facing output after ${maxNoProgressTurns} turns.`,
                    );
                  }
                  continue;
                } else {
                  try {
                    action = parseAgentAction(text);
                  } catch {
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
              consecutiveNoProgressIterations += 1;
              if (consecutiveNoProgressIterations >= maxNoProgressTurns) {
                throw new Error(
                  `The agent made no filesystem progress after ${maxNoProgressTurns} turns.`,
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
              if (consecutiveNoProgressIterations >= maxNoProgressTurns) {
                throw new Error(
                  `The agent repeatedly attempted an unsafe design-direction action (${maxNoProgressTurns} turns).`,
                );
              }
              continue;
            }

            const toolResults: string[] = [];
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
                runRequests.push({
                  index: toolResults.length,
                  step,
                  command: currentAction.command,
                  toolCallId: streamedToolCalls[actionIndex]?.id ?? currentStepId,
                });
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
                            createdById: user.id,
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
                        createdById: user.id,
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

            for (const request of runRequests) {
              toolResults[request.index] = await executeRuntimeRun(request);
            }

            if (handledFilesystemMutation) {
              consecutiveNoProgressIterations = 0;
            } else if (!askQuestionsAction && !respondAction && !finishAction) {
              consecutiveNoProgressIterations += 1;
              if (consecutiveNoProgressIterations >= maxNoProgressTurns) {
                throw new Error(
                  `The agent made no filesystem progress after ${maxNoProgressTurns} turns.`,
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

          throw new Error(
            maxIterations === undefined
              ? 'The agent loop ended without a terminal action.'
              : `Agent exceeded ${maxIterations} steps without finishing`,
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
              code:
                error instanceof ProviderError &&
                (error.status === 0 || error.code !== 'loopback_blocked')
                  ? error.code
                  : undefined,
            });
          }
          await settleGenerationRun(stoppedByClient ? 'CANCELED' : 'FAILED', finalUsage);
        } finally {
          await releaseGenerationLease();
          queue.end();
        }
      };

      runLoop();

      try {
        for await (const chunk of queue) {
          yield chunk;
        }
      } finally {
        abortController.abort();
        await releaseGenerationLease();
      }
    };

    leaseTransferredToStream = true;
    return {
      ok: true,
      generator: runExecution(),
    };
  } finally {
    if (!leaseTransferredToStream) {
      await releaseGenerationLease();
    }
  }
}
