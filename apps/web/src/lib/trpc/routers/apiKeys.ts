import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { getProvider } from '@app-builder/ai-gateway';
import type { AIProvider } from '@app-builder/shared';
import { protectedProcedure, router } from '../trpc';
import { encryptApiKey, decryptApiKey, maskApiKey } from '@/lib/crypto';

const providerSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'mistral',
  'groq',
  'ollama',
  'custom',
]);

type ProviderId = z.infer<typeof providerSchema>;

interface StoredKeyRecord {
  id: string;
  provider: string;
  encryptedKey: string;
  label: string | null;
  baseUrl: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

function parseProvider(provider: string): ProviderId {
  const result = providerSchema.safeParse(provider);
  if (!result.success) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Unsupported provider: ${provider}`,
    });
  }
  return result.data;
}

async function fetchModels(key: StoredKeyRecord): Promise<string[]> {
  const provider = parseProvider(key.provider);
  const plaintext = decryptApiKey(key.encryptedKey);
  return getProvider(provider as AIProvider).listModels(plaintext, key.baseUrl ?? undefined);
}

export const apiKeysRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const keys: StoredKeyRecord[] = await ctx.db.apiKey.findMany({
      where: { userId: ctx.user.id },
      orderBy: { createdAt: 'desc' },
    });

    return keys.map((key) => ({
      id: key.id,
      provider: parseProvider(key.provider),
      label: key.label,
      baseUrl: key.baseUrl,
      createdAt: key.createdAt,
      lastUsedAt: key.lastUsedAt,
      maskedKey: maskApiKey(decryptApiKey(key.encryptedKey)),
    }));
  }),

  save: protectedProcedure
    .input(
      z.object({
        provider: providerSchema,
        key: z.string().min(1),
        label: z.string().max(100).optional(),
        baseUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const encryptedKey = encryptApiKey(input.key);
      const existing = await ctx.db.apiKey.findFirst({
        where: { userId: ctx.user.id, provider: input.provider },
      });

      const key = existing
        ? await ctx.db.apiKey.update({
            where: { id: existing.id },
            data: {
              encryptedKey,
              label: input.label ?? null,
              baseUrl: input.baseUrl ?? null,
            },
          })
        : await ctx.db.apiKey.create({
            data: {
              userId: ctx.user.id,
              provider: input.provider,
              encryptedKey,
              label: input.label ?? null,
              baseUrl: input.baseUrl ?? null,
            },
          });

      return {
        id: key.id,
        provider: input.provider,
        label: key.label,
        baseUrl: key.baseUrl,
        maskedKey: maskApiKey(input.key),
      };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const key = await ctx.db.apiKey.findFirst({
        where: { id: input.id, userId: ctx.user.id },
      });
      if (!key) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'API key not found' });
      }
      await ctx.db.apiKey.delete({ where: { id: input.id } });
      return { success: true as const };
    }),

  test: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const key: StoredKeyRecord | null = await ctx.db.apiKey.findFirst({
      where: { id: input.id, userId: ctx.user.id },
    });
    if (!key) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'API key not found' });
    }

    try {
      const models = await fetchModels(key);
      await ctx.db.apiKey.update({
        where: { id: key.id },
        data: { lastUsedAt: new Date() },
      });
      return { models };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Connection failed';
      throw new TRPCError({ code: 'BAD_REQUEST', message });
    }
  }),

  listModels: protectedProcedure.query(async ({ ctx }) => {
    const keys: StoredKeyRecord[] = await ctx.db.apiKey.findMany({
      where: { userId: ctx.user.id },
      orderBy: { createdAt: 'asc' },
    });

    const groups = await Promise.all(
      keys.map(async (key) => {
        const provider = parseProvider(key.provider);
        try {
          const models = await fetchModels(key);
          return {
            provider,
            models,
            error: null,
          };
        } catch (error) {
          return {
            provider,
            models: [] as string[],
            error: error instanceof Error ? error.message : 'Failed to fetch models',
          };
        }
      }),
    );

    return groups;
  }),
});
