import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { getProvider, SsrfError, validateOutboundUrl } from '@app-builder/ai-gateway';
import { protectedProcedure, router } from '../trpc';
import { encryptApiKey, decryptApiKey, maskApiKey } from '@/lib/crypto';
import { checkRateLimit } from '@/server/rate-limit';
import { canManageKey, keyAddedByOtherError, requireRealmRole } from '@/server/authz';
import type { RealmRole } from '@app-builder/shared';

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

/** Stored in place of a key for Ollama, which authenticates nothing; the provider ignores it. */
const OLLAMA_KEY = 'ollama';

interface StoredKeyRecord {
  id: string;
  userId: string;
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

async function fetchModels(key: StoredKeyRecord, signal?: AbortSignal): Promise<string[]> {
  const provider = parseProvider(key.provider);
  const plaintext = decryptApiKey(key.encryptedKey);
  return getProvider(provider).listModels(plaintext, key.baseUrl ?? undefined, signal);
}
/** Who added a key, as everyone in the Realm sees it. */
const addedBySelect = { user: { select: { name: true, email: true } } } as const;

type KeyWithAdder = StoredKeyRecord & { user: { name: string | null; email: string } };

function adderName(key: KeyWithAdder): string {
  return key.user.name ?? key.user.email;
}

/**
 * A Realm's key as the viewer may see it. Everyone sees which provider is
 * connected and who added it, so they know whose account their builds use.
 * Whoever may change the key (see `canManageKey`) also gets the masked form
 * and endpoint. The plaintext never leaves the server.
 */
export function presentKey(key: KeyWithAdder, viewer: { role: RealmRole; userId: string }) {
  const canManage = canManageKey(viewer.role, key.userId, viewer.userId);
  return {
    id: key.id,
    provider: parseProvider(key.provider),
    label: key.label,
    addedBy: adderName(key),
    addedByYou: key.userId === viewer.userId,
    canManage,
    baseUrl: canManage ? key.baseUrl : null,
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    maskedKey: canManage ? maskApiKey(decryptApiKey(key.encryptedKey)) : null,
  };
}

const realmInput = z.object({ realmId: z.string().uuid() });

export const apiKeysRouter = router({
  /** The Realm's provider keys. Any member; see `presentKey` for what each viewer sees. */
  list: protectedProcedure.input(realmInput).query(async ({ ctx, input }) => {
    const { role } = await requireRealmRole(ctx, input.realmId, 'MEMBER');
    const keys: KeyWithAdder[] = await ctx.db.apiKey.findMany({
      where: { realmId: input.realmId },
      orderBy: { createdAt: 'desc' },
      include: addedBySelect,
    });
    return keys.map((key) => presentKey(key, { role, userId: ctx.user.id }));
  }),

  /**
   * Verify the key against the provider, then store it in the Realm. A key
   * that fails verification is never saved. Owner/Admin may add a key; only
   * whoever added the one in its place, or the Owner, may replace it.
   */
  save: protectedProcedure
    .input(
      z.object({
        realmId: z.string().uuid(),
        provider: providerSchema,
        // Ollama takes no key; every other provider requires one.
        key: z.string().optional(),
        label: z.string().max(100).optional(),
        baseUrl: z.string().url().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { role } = await requireRealmRole(ctx, input.realmId, 'ADMIN');

      // The unique key is (realmId, provider, label): matching on provider alone
      // silently overwrote (and renamed) a key stored under another label.
      // Checked before anything is verified, so a refusal costs no rate limit.
      const label = input.label ?? null;
      const existing = await ctx.db.apiKey.findFirst({
        where: { realmId: input.realmId, provider: input.provider, label },
        include: addedBySelect,
      });
      if (existing && !canManageKey(role, existing.userId, ctx.user.id)) {
        throw keyAddedByOtherError(adderName(existing));
      }

      const plaintextKey = input.provider === 'ollama' ? OLLAMA_KEY : input.key?.trim();
      if (!plaintextKey) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Paste an API key to connect.' });
      }
      if (input.provider === 'custom' && !input.baseUrl) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Custom providers require a base URL.',
        });
      }
      if (input.baseUrl) {
        try {
          await validateOutboundUrl(input.baseUrl);
        } catch (error) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message:
              error instanceof SsrfError
                ? error.message
                : 'Invalid base URL. Use https:// for remote endpoints, or http://localhost for local servers.',
          });
        }
      }

      const rate = await checkRateLimit('apiKeyTest', ctx.user.id);
      if (!rate.allowed) {
        const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Too many attempts. Try again in ${retryIn}s.`,
        });
      }

      let models: string[];
      try {
        models = await getProvider(input.provider).listModels(plaintextKey, input.baseUrl);
      } catch {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            input.provider === 'ollama'
              ? "Couldn't reach Ollama at that URL. Make sure the server is running."
              : input.provider === 'custom'
                ? "This key didn't work with that URL. Check both and try again."
                : "This key didn't work. Double-check it was copied fully.",
        });
      }

      const encryptedKey = encryptApiKey(plaintextKey);
      // Whoever saves the key now provides it, so it is recorded as theirs.
      const key = existing
        ? await ctx.db.apiKey.update({
            where: { id: existing.id },
            data: { encryptedKey, label, baseUrl: input.baseUrl ?? null, userId: ctx.user.id },
          })
        : await ctx.db.apiKey.create({
            data: {
              realmId: input.realmId,
              userId: ctx.user.id,
              provider: input.provider,
              encryptedKey,
              label,
              baseUrl: input.baseUrl ?? null,
            },
          });

      return {
        id: key.id,
        provider: input.provider,
        label: key.label,
        baseUrl: key.baseUrl,
        maskedKey: maskApiKey(plaintextKey),
        models,
      };
    }),

  /** Remove a key from the Realm. Whoever added it, or the Owner. */
  delete: protectedProcedure
    .input(z.object({ realmId: z.string().uuid(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { role } = await requireRealmRole(ctx, input.realmId, 'ADMIN');
      const key = await ctx.db.apiKey.findFirst({
        where: { id: input.id, realmId: input.realmId },
        include: addedBySelect,
      });
      if (!key) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'API key not found' });
      }
      if (!canManageKey(role, key.userId, ctx.user.id)) {
        throw keyAddedByOtherError(adderName(key));
      }
      await ctx.db.apiKey.delete({ where: { id: input.id } });
      return { success: true as const };
    }),

  /** Check a stored key still works. Owner/Admin. */
  test: protectedProcedure
    .input(z.object({ realmId: z.string().uuid(), id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireRealmRole(ctx, input.realmId, 'ADMIN');
      const key: StoredKeyRecord | null = await ctx.db.apiKey.findFirst({
        where: { id: input.id, realmId: input.realmId },
      });
      if (!key) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'API key not found' });
      }

      const rate = await checkRateLimit('apiKeyTest', ctx.user.id);
      if (!rate.allowed) {
        const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Too many connection tests. Try again in ${retryIn}s.`,
        });
      }

      try {
        const models = await fetchModels(key);
        await ctx.db.apiKey.update({
          where: { id: key.id },
          data: { lastUsedAt: new Date() },
        });
        return { models };
      } catch {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Connection failed. Check the API key and base URL, then try again.',
        });
      }
    }),

  /** Models each of the Realm's keys can reach, for the builder's model picker. Any member. */
  listModels: protectedProcedure.input(realmInput).query(async ({ ctx, input }) => {
    await requireRealmRole(ctx, input.realmId, 'MEMBER');
    const keys: StoredKeyRecord[] = await ctx.db.apiKey.findMany({
      where: { realmId: input.realmId },
      orderBy: { createdAt: 'asc' },
    });

    const withTimeout = <T>(promise: Promise<T>, _ms: number, signal: AbortSignal): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          const onAbort = () => reject(new Error('Timed out'));
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        }),
      ]);

    const groups = await Promise.all(
      keys.map(async (key) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        const provider = parseProvider(key.provider);
        try {
          const models = await withTimeout(
            fetchModels(key, controller.signal),
            10_000,
            controller.signal,
          );
          return {
            id: key.id,
            provider,
            models,
            error: null,
          };
        } catch {
          return {
            id: key.id,
            provider,
            models: [] as string[],
            error: 'Failed to fetch models',
          };
        } finally {
          clearTimeout(timeout);
        }
      }),
    );

    return groups;
  }),
});
