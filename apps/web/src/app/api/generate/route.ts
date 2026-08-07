import { getServerSession } from 'next-auth';
import { NextRequest } from 'next/server';
import { getProvider } from '@app-builder/ai-gateway';
import { AIProvider } from '@app-builder/shared';
import { authOptions } from '@/lib/auth';
import { decryptApiKey } from '@/lib/crypto';
import { getDb } from '@/lib/db';
import {
  GENERATION_PROTOCOL_PROMPT,
  appendGenerationContinuation,
  extractThinking,
  getActiveGeneratedFile,
  getGenerationContinuationPrompt,
  parseGenerationArtifact,
  parsePatchArtifact,
  applyGeneratedPatches,
  isGenerationArtifactComplete,
} from '@/lib/generation-protocol';
import { persistProjectFiles } from '@/lib/project-files';
import { createVersion } from '@/lib/versioning';

export const dynamic = 'force-dynamic';

interface GenerateBody {
  projectId?: string;
  message?: string;
  modelProvider?: string;
  modelName?: string;
  reasoningEffort?: string;
  editTarget?: {
    sourceFile?: string;
    tagName?: string;
    selector?: string;
    outerHTML?: string;
  };
}

function parseProvider(value: string): AIProvider {
  const parsed = AIProvider.safeParse(value);
  if (!parsed.success) throw new Error(`Unsupported AI provider: ${value}`);
  return parsed.data;
}
function encodeEvent(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json()) as GenerateBody;
  const projectId = body.projectId?.trim();
  const prompt = body.message?.trim();
  if (!projectId || !prompt || !body.modelProvider || !body.modelName) {
    return Response.json({ error: 'Missing generation input' }, { status: 400 });
  }

  const db = getDb();
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      collaborators: { where: { userId: session.user.id }, select: { userId: true } },
      files: { orderBy: { path: 'asc' } },
    },
  });
  if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });
  if (project.ownerId !== session.user.id && project.collaborators.length === 0) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const providerName = parseProvider(body.modelProvider);
  const storedKey = await db.apiKey.findFirst({
    where: { userId: session.user.id, provider: providerName },
  });
  if (!storedKey) {
    return Response.json({ error: `No API key configured for ${providerName}` }, { status: 400 });
  }

  const apiKey = decryptApiKey(storedKey.encryptedKey);
  const userMessage = await db.chatMessage.create({
    data: {
      projectId,
      role: 'user',
      content: prompt,
      model: `${providerName}:${body.modelName}`,
    },
  });

  const conversation = await db.chatMessage.findMany({
    where: { projectId },
    orderBy: { timestamp: 'desc' },
    take: 12,
    select: { role: true, content: true },
  });

  const currentFiles = project.files
    .map((file) => `--- ${file.path} ---\n${file.content}`)
    .join('\n\n');
  const systemPrompt = `${GENERATION_PROTOCOL_PROMPT}\n\nProject: ${project.name}\n${project.description ?? ''}\n\nCurrent files:\n${currentFiles || '(empty project)'}`;
  const isTargetedEdit = Boolean(body.editTarget?.selector && body.editTarget.sourceFile);
  const generationPrompt = isTargetedEdit
    ? `You are applying one targeted visual edit to an existing website. Do not redesign, regenerate, or rewrite the project. Return only this exact patch protocol, with no markdown fences or text outside markers:
<<<MESSAGE>>>
Short summary
<<<END_MESSAGE>>>
<<<PATCH:${body.editTarget?.sourceFile}>>>
<<<<<<< SEARCH
Exact existing source text
=======
Replacement source text
>>>>>>> REPLACE
<<<END_PATCH>>>
<<<END_BUILD>>>
Rules: emit exactly one patch for the selected source file; copy the SEARCH block exactly from the current file; the search text must occur exactly once; keep the patch as small as possible; do not change unrelated content.

Selected element metadata: ${JSON.stringify(body.editTarget)}

User request: ${prompt}

Current files:
${currentFiles || '(empty project)'}`
    : systemPrompt;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(encodeEvent(event, data));
      try {
        send('phase', { phase: 'planning', label: 'Planning your app' });
        const provider = getProvider(providerName);
        const baseMessages = [
          { role: 'system' as const, content: generationPrompt },
          ...conversation.reverse().map((message) => ({
            role: message.role === 'assistant' ? 'assistant' as const : 'user' as const,
            content: message.content,
          })),
        ];

        let raw = '';
        let reasoningContent = '';
        let lastPath = '';
        let lastLength = 0;
        const completedFileContents = new Map<string, string>();
        const emitCompletedFiles = () => {
          if (isTargetedEdit) return;
          for (const file of parseGenerationArtifact(raw).files) {
            if (completedFileContents.get(file.path) === file.content) continue;
            completedFileContents.set(file.path, file.content);
            send('file-complete', file);
          }
        };
        let finalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

        const maxPasses = 8;
        for (let pass = 0; pass < maxPasses; pass += 1) {
          if (pass > 0) {
            send('phase', { phase: 'generating', label: `Continuing large build (${pass + 1}/${maxPasses})` });
          }
          const messages = pass === 0
            ? baseMessages
            : [
                ...baseMessages,
                { role: 'assistant' as const, content: raw },
                { role: 'user' as const, content: getGenerationContinuationPrompt(raw) },
              ];
          const rawBeforePass = raw;
          let passContent = '';
          const generator = provider.stream(
            body.modelName!,
            messages,
            apiKey,
            { baseUrl: storedKey.baseUrl ?? undefined, maxTokens: 16_000, temperature: 0.3, reasoningEffort: body.reasoningEffort },
          );
          let finishReason = 'stop';

          while (true) {
            const next = await generator.next();
            if (next.done) {
              finishReason = next.value.finishReason ?? finishReason;
              const usage = next.value.usage;
              if (usage) {
                finalUsage = {
                  promptTokens: finalUsage.promptTokens + usage.promptTokens,
                  completionTokens: finalUsage.completionTokens + usage.completionTokens,
                  totalTokens: finalUsage.totalTokens + usage.totalTokens,
                };
              }
              break;
            }

            if (next.value.reasoning) {
              reasoningContent += next.value.reasoning;
              send('thinking', { content: reasoningContent });
            }
            passContent += next.value.content;
            raw += next.value.content;

            if (isTargetedEdit) {
              send('phase', { phase: 'generating', label: 'Applying targeted element edit' });
              continue;
            }
            const active = getActiveGeneratedFile(raw);
            if (!active) {
              send('phase', { phase: 'generating', label: 'Designing and writing code' });
              continue;
            }
            if (active.path !== lastPath) {
              lastPath = active.path;
              lastLength = 0;
              send('file-start', { path: active.path });
            }
            if (active.content.length !== lastLength) {
              lastLength = active.content.length;
              send('file-progress', {
                path: active.path,
                content: active.content,
                line: active.content.split('\n').length,
                column: active.content.split('\n').at(-1)?.length ?? 0,
              });
            }
            emitCompletedFiles();
          }
          if (pass > 0) {
            raw = appendGenerationContinuation(rawBeforePass, passContent);
            if (!isTargetedEdit) {
              const active = getActiveGeneratedFile(raw);
              if (active) {
                lastPath = active.path;
                lastLength = active.content.length;
                send('file-progress', {
                  path: active.path,
                  content: active.content,
                  line: active.content.split('\n').length,
                  column: active.content.split('\n').at(-1)?.length ?? 0,
                });
              }
            }
          }
          emitCompletedFiles();

          if (isGenerationArtifactComplete(raw)) break;
          if (pass === maxPasses - 1) {
            throw new Error(`The model did not finish this build after ${maxPasses} continuation passes. Try a model with a larger context window or split the request into phases.`);
          }
        }

        send('phase', { phase: 'building', label: 'Applying files and refreshing preview' });

        // Use reasoning from stream (DeepSeek reasoning_content) as primary,
        // fall back to tag-based extraction for other formats.
        const { thinking: tagThinking, cleaned: cleanedRaw } = reasoningContent
          ? { thinking: reasoningContent, cleaned: raw }
          : extractThinking(raw);
        if (isTargetedEdit) {
          const patchArtifact = parsePatchArtifact(cleanedRaw);
          if (patchArtifact.patches.length === 0) {
            throw new Error('The targeted edit did not return a valid patch. No files were changed.');
          }
          if (patchArtifact.patches.some((patch) => patch.path !== body.editTarget?.sourceFile)) {
            throw new Error('The targeted edit attempted to modify a file outside the selected element. No files were changed.');
          }
          const updatedFiles = applyGeneratedPatches(
            project.files.map((file) => ({ path: file.path, content: file.content })),
            patchArtifact.patches,
          );
          const changedPaths = new Set(patchArtifact.patches.map((patch) => patch.path));
          const changedFiles = updatedFiles.filter((file) => changedPaths.has(file.path));
          const assistantContent = patchArtifact.message || `Applied targeted edit to ${changedFiles.map((file) => file.path).join(', ')}.`;
          const assistantMessage = await db.chatMessage.create({
            data: { projectId, role: 'assistant', content: assistantContent, model: `${providerName}:${body.modelName}` } as never,
          });
          const finalThinking = tagThinking || null;
          if (finalThinking) {
            await db.$executeRawUnsafe(`UPDATE chat_messages SET thinking = $1 WHERE id = $2`, finalThinking, assistantMessage.id);
          }
          await persistProjectFiles(db, projectId, changedFiles);
          const version = await createVersion(
            projectId,
            assistantMessage.id,
            changedFiles.map((file) => ({ file: file.path, operation: 'update', after: file.content })),
          );
          await db.apiKey.update({ where: { id: storedKey.id }, data: { lastUsedAt: new Date() } });
          send('ready', {
            userMessage: { id: userMessage.id, role: userMessage.role, content: userMessage.content, timestamp: userMessage.timestamp, model: userMessage.model },
            assistantMessage: { id: assistantMessage.id, role: assistantMessage.role, content: assistantMessage.content, timestamp: assistantMessage.timestamp, model: assistantMessage.model, tokenUsage: finalUsage },
            thinking: finalThinking,
            files: updatedFiles,
            versionNumber: version.versionNumber,
          });
          return;
        }
         const artifact = parseGenerationArtifact(cleanedRaw);
        if (artifact.questions.length > 0 && artifact.files.length === 0) {
          const content = artifact.questions.map((item, index) => `${index + 1}. ${item.question}`).join('\n');
          const assistantMessage = await db.chatMessage.create({
            data: {
              projectId,
              role: 'assistant',
              content,
              model: `${providerName}:${body.modelName}`,
            },
          });
          send('questions', {
            questions: artifact.questions,
            userMessage: {
              id: userMessage.id,
              role: userMessage.role,
              content: userMessage.content,
              timestamp: userMessage.timestamp,
              model: userMessage.model,
            },
            assistantMessage: {
              id: assistantMessage.id,
              role: assistantMessage.role,
              content: assistantMessage.content,
              timestamp: assistantMessage.timestamp,
              model: assistantMessage.model,
            },
          });
          return;
        }
        if (artifact.files.length === 0) {
          throw new Error('The model did not return any buildable files. Try a stronger coding model.');
        }
        const finalThinking = tagThinking || null;
        const hasMeaningfulMessage = artifact.message.length > 3 || /[a-zA-Z0-9]{4,}/.test(artifact.message);
        const assistantContent = hasMeaningfulMessage
          ? artifact.message
          : `Built ${artifact.files.length} project file${artifact.files.length === 1 ? '' : 's'}.`;
        const assistantMessage = await db.chatMessage.create({
          data: {
            projectId,
            role: 'assistant',
            content: assistantContent,
            model: `${providerName}:${body.modelName}`,
          } as never,
        });
        // Thinking field only exists in the DB, not in the stale prisma/generated/ client
        if (finalThinking) {
          await db.$executeRawUnsafe(
            `UPDATE chat_messages SET thinking = $1 WHERE id = $2`,
            finalThinking,
            assistantMessage.id,
          );
        }
        await persistProjectFiles(db, projectId, artifact.files);
        const version = await createVersion(
          projectId,
          assistantMessage.id,
          artifact.files.map((file) => ({ file: file.path, operation: 'update', after: file.content })),
        );
        await db.apiKey.update({ where: { id: storedKey.id }, data: { lastUsedAt: new Date() } });

        send('ready', {
          userMessage: {
            id: userMessage.id,
            role: userMessage.role,
            content: userMessage.content,
            timestamp: userMessage.timestamp,
            model: userMessage.model,
          },
          assistantMessage: {
            id: assistantMessage.id,
            role: assistantMessage.role,
            content: assistantMessage.content,
            timestamp: assistantMessage.timestamp,
            model: assistantMessage.model,
            tokenUsage: finalUsage,
          },
          thinking: finalThinking,
          files: artifact.files,
          versionNumber: version.versionNumber,
        });
      } catch (error) {
        send('failed', { message: error instanceof Error ? error.message : 'Generation failed' });
      } finally {
        controller.close();
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
