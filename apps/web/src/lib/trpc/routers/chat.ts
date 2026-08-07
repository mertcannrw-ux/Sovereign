import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { getProvider } from '@app-builder/ai-gateway';
import { AIProvider } from '@app-builder/shared';
import { protectedProcedure, router } from '../trpc';
import { decryptApiKey } from '@/lib/crypto';
import { parseResponse, validateChanges } from '@app-builder/codegen';
import {
  createVersion,
  getVersions,
  restoreVersion,
  parseFileDiffsFromResponse,
} from '@/lib/versioning';
import type { VersionDiffEntry } from '@/lib/versioning';
import { persistProjectFiles } from '@/lib/project-files';

export const chatRouter = router({
  /**
   * Send a chat message to the AI and receive a response.
   *
   * 1. Validates the current user owns or collaborates on the project.
   * 2. Fetches the user's stored API key for the project's AI provider.
   * 3. Calls the provider API with the conversation history.
   * 4. Persists the user message and assistant response to the database.
   * 5. Returns the assistant's reply together with usage metadata.
   */
  send: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        message: z.string().min(1),
        modelProvider: z.string().optional(),
        modelName: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // ── 1. Validate project access ──────────────────────────────
      const project = await ctx.db.project.findUnique({
        where: { id: input.projectId },
        include: {
          collaborators: {
            where: { userId: ctx.user.id },
          },
        },
      });

      if (!project) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        });
      }

      const isOwner = project.ownerId === ctx.user.id;
      const isCollab = project.collaborators.length > 0;
      if (!isOwner && !isCollab) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have access to this project',
        });
      }

      // ── 2. Resolve provider / model ─────────────────────────────
      const provider = input.modelProvider ?? project.modelProvider;
      const model = input.modelName ?? project.modelName;

      // ── 3. Fetch & decrypt the user's API key ───────────────────
      const storedKey = await ctx.db.apiKey.findFirst({
        where: { userId: ctx.user.id, provider },
      });

      if (!storedKey) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `No API key configured for ${provider}. Please add one in Settings.`,
        });
      }

      let decryptedKey: string;
      try {
        decryptedKey = decryptApiKey(storedKey.encryptedKey);
      } catch {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to decrypt the stored API key',
        });
      }

      // Bump last-used timestamp
      await ctx.db.apiKey.update({
        where: { id: storedKey.id },
        data: { lastUsedAt: new Date() },
      });

      // ── 4. Save the user message immediately ────────────────────
      const userMessage = await ctx.db.chatMessage.create({
        data: {
          projectId: project.id,
          role: 'user',
          content: input.message,
          model: `${provider}:${model}`,
        },
      });

      // ── 5. Load recent conversation history (last 20 messages) ──
      const history = await ctx.db.chatMessage.findMany({
        where: { projectId: project.id },
        orderBy: { timestamp: 'asc' },
        take: 20,
      });

      const conversation = history.map((m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      }));

      // ── 6. Call the AI provider ─────────────────────────────────
      let responseContent: string;
      let usage: { promptTokens: number; completionTokens: number; totalTokens: number };

      try {
        const result = await callAIProvider(
          provider,
          model,
          conversation,
          decryptedKey,
          storedKey.baseUrl ?? undefined,
        );
        responseContent = result.content;
        usage = result.usage;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'AI provider call failed';
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `AI request failed: ${message}`,
        });
      }

      // ── 7. Persist the assistant's reply ────────────────────────
      const assistantMessage = await ctx.db.chatMessage.create({
        data: {
          projectId: project.id,
          role: 'assistant',
          content: responseContent,
          model: `${provider}:${model}`,
          tokenUsage: usage,
        },
      });
      // ── 8. Parse file diffs from the response & create a version ────
      let fileDiffs: VersionDiffEntry[] = [];
      let parsingMethod: 'structured' | 'legacy' = 'structured';
      let parsingErrors: string[] = [];
      let versionNumber: number | null = null;

      // Try structured tool output parsing first (provider tool/schema output
      // for write_file, delete_file, and ask_user).
      try {
        const toolOutput = parseResponse(responseContent);

        // Build a manifest from existing project state.
        // Phase 4+ will hydrate this from ProjectFile records; for now an
        // empty manifest means every path in the changeset is treated as new.
        const manifest: Record<string, string> = {};

        // Default budget — production values come from entitlements (Phase 7).
        const budget = { maxInputTokens: 0, maxOutputFiles: 50, maxOutputBytes: 5 * 1024 * 1024 };

        const { valid, diagnostics: validationDiags } = validateChanges(
          toolOutput.changes,
          manifest,
          budget,
        );

        // Collect error-level diagnostics for the response
        parsingErrors = validationDiags.filter((d) => d.severity === 'error').map((d) => d.message);

        if (valid.length > 0) {
          fileDiffs = valid.map((change) => ({
            file: change.path,
            operation: change.operation.toLowerCase() as 'create' | 'update' | 'delete',
            after: change.content,
          }));
        }
      } catch {
        // Fall back to markdown-heuristic parsing for backward compatibility
        // with responses that don't use the structured tool format.
        parsingMethod = 'legacy';
        fileDiffs = parseFileDiffsFromResponse(responseContent);
      }

      if (fileDiffs.length > 0) {
        const generatedFiles = fileDiffs
          .filter((file) => file.operation !== 'delete' && file.after !== undefined)
          .map((file) => ({ path: file.file, content: file.after ?? '' }));
        await persistProjectFiles(ctx.db, project.id, generatedFiles);
        const result = await createVersion(project.id, assistantMessage.id, fileDiffs);
        versionNumber = result.versionNumber;
      }

      // ── 9. Return the response ─────────────────────────────────────
      return {
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
          tokenUsage: assistantMessage.tokenUsage as {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
          } | null,
        },
        version: versionNumber !== null ? { versionNumber, fileDiffs } : null,
        parsingMethod,
        ...(parsingErrors.length > 0 ? { parsingErrors } : {}),
      };
    }),

  /**
   * Fetch the message history for a project.
   * Validates the caller has access to the project first.
   */
  getHistory: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.project.findUnique({
        where: { id: input.projectId },
        select: { id: true, ownerId: true },
      });

      if (!project) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        });
      }

      const isOwner = project.ownerId === ctx.user.id;
      const isCollab = !!(await ctx.db.projectCollaborator.findFirst({
        where: { projectId: project.id, userId: ctx.user.id },
      }));

      if (!isOwner && !isCollab) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have access to this project',
        });
      }

      const messages = await ctx.db.chatMessage.findMany({
        where: { projectId: project.id },
        orderBy: { timestamp: 'asc' },
      });
      return messages.map(
        (m: {
          id: string;
          role: string;
          content: string;
          timestamp: string | Date;
          model: string;
          toolCalls: unknown;
          tokenUsage: unknown;
          filesModified: unknown;
          thinking?: string | null;
        }) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          model: m.model,
          toolCalls: m.toolCalls,
          filesModified: m.filesModified,
          tokenUsage: m.tokenUsage,
          thinking: m.thinking,
        }),
      );
    }),

  /**
   * Get the full version history timeline for a project.
   */
  getVersions: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const project = await ctx.db.project.findUnique({
        where: { id: input.projectId },
        select: { id: true, ownerId: true },
      });

      if (!project) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        });
      }

      const isOwner = project.ownerId === ctx.user.id;
      const isCollab = !!(await ctx.db.projectCollaborator.findFirst({
        where: { projectId: project.id, userId: ctx.user.id },
      }));

      if (!isOwner && !isCollab) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have access to this project',
        });
      }

      return getVersions(project.id);
    }),

  /**
   * Restore a project to a specific version number.
   * Creates a new version entry recording the rollback.
   */
  restoreVersion: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        versionNumber: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.db.project.findUnique({
        where: { id: input.projectId },
        select: { id: true, ownerId: true },
      });

      if (!project) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Project not found',
        });
      }

      const isOwner = project.ownerId === ctx.user.id;
      const isCollab = !!(await ctx.db.projectCollaborator.findFirst({
        where: { projectId: project.id, userId: ctx.user.id },
      }));

      if (!isOwner && !isCollab) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'You do not have access to this project',
        });
      }

      const result = await restoreVersion(project.id, input.versionNumber);
      return result;
    }),
});

// ─── AI Provider API calls ────────────────────────────────────────────

interface AIResult {
  content: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

function parseProvider(value: string): AIProvider {
  const result = AIProvider.safeParse(value);
  if (!result.success) {
    throw new Error(`Unsupported AI provider: ${value}`);
  }
  return result.data;
}

function parseRole(value: string): 'user' | 'assistant' | 'system' {
  if (value === 'user' || value === 'assistant' || value === 'system') return value;
  return 'user';
}

async function callAIProvider(
  provider: string,
  model: string,
  messages: { role: string; content: string }[],
  apiKey: string,
  baseUrl?: string,
): Promise<AIResult> {
  const result = await getProvider(parseProvider(provider)).complete(
    model,
    messages.map((message) => ({
      role: parseRole(message.role),
      content: message.content,
    })),
    apiKey,
    {
      baseUrl,
      maxTokens: 4096,
    },
  );

  return {
    content: result.content,
    usage: result.usage,
  };
}
