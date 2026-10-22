import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import {
  normalizeImageEndpoint,
  ssrfFetch,
  SsrfError,
  validateOutboundUrl,
} from '@app-builder/ai-gateway';
import { protectedProcedure, router } from '../trpc';
import { encryptApiKey, decryptApiKey, maskApiKey } from '@/lib/crypto';
import { checkRateLimit } from '@/server/rate-limit';
import { canManageKey, keyAddedByOtherError, requireRealmRole } from '@/server/authz';

/** Who added the config, as everyone in the Realm sees it. */
const addedBySelect = { user: { select: { name: true, email: true } } } as const;

export const imageProviderRouter = router({
  /**
   * The Realm's image provider config. Any member can see whether one is set
   * up and who added it; whoever may change it (see `canManageKey`) also sees
   * its endpoint and masked key.
   */
  get: protectedProcedure
    .input(z.object({ realmId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { role } = await requireRealmRole(ctx, input.realmId, 'MEMBER');
      const config = await ctx.db.imageProviderConfig.findFirst({
        where: { realmId: input.realmId },
        orderBy: { createdAt: 'desc' },
        include: addedBySelect,
      });

      if (!config) return null;
      const canManage = canManageKey(role, config.userId, ctx.user.id);

      let maskedKey: string | null = null;
      if (canManage) {
        try {
          maskedKey = maskApiKey(decryptApiKey(config.encryptedKey));
        } catch {
          maskedKey = '****';
        }
      }

      return {
        id: config.id,
        baseUrl: canManage ? config.baseUrl : null,
        model: config.model,
        label: config.label,
        enabled: config.enabled,
        addedBy: config.user.name ?? config.user.email,
        addedByYou: config.userId === ctx.user.id,
        canManage,
        maskedKey,
        createdAt: config.createdAt,
        lastUsedAt: config.lastUsedAt,
      };
    }),

  /**
   * Save (upsert) the Realm's image provider config. Owner/Admin may add one;
   * only whoever added the existing one, or the Owner, may change it.
   */
  save: protectedProcedure
    .input(
      z.object({
        realmId: z.string().uuid(),
        baseUrl: z.string().min(1),
        apiKey: z.string().optional(),
        model: z.string().min(1).default('dall-e-3'),
        label: z.string().optional().default('default'),
        enabled: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { role } = await requireRealmRole(ctx, input.realmId, 'ADMIN');
      let normalizedBaseUrl = input.baseUrl.trim();
      if (!normalizedBaseUrl.startsWith('http://') && !normalizedBaseUrl.startsWith('https://')) {
        normalizedBaseUrl = `https://${normalizedBaseUrl}`;
      }
      try {
        await validateOutboundUrl(normalizedBaseUrl);
      } catch (error) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: error instanceof SsrfError ? error.message : 'Invalid base URL provided',
        });
      }

      const normalizedEndpoint = normalizeImageEndpoint(normalizedBaseUrl);

      const existing = await ctx.db.imageProviderConfig.findFirst({
        where: { realmId: input.realmId, label: input.label },
        include: addedBySelect,
      });
      if (existing && !canManageKey(role, existing.userId, ctx.user.id)) {
        throw keyAddedByOtherError(existing.user.name ?? existing.user.email);
      }

      let encryptedKey: string;
      if (input.apiKey && input.apiKey.trim().length > 0) {
        encryptedKey = encryptApiKey(input.apiKey.trim());
      } else if (existing) {
        // Reusing the stored secret is only safe while it stays bound to the
        // endpoint it was entered for. Otherwise one Realm admin could point
        // the config at a host they control and have another admin's key sent
        // there (the "Test" action, or the next image generation).
        if (existing.baseUrl !== normalizedEndpoint) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'Re-enter the API key when changing the endpoint.',
          });
        }
        encryptedKey = existing.encryptedKey;
      } else {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'API Key is required for new image provider configuration',
        });
      }

      const saved = await ctx.db.imageProviderConfig.upsert({
        where: {
          realmId_label: {
            realmId: input.realmId,
            label: input.label,
          },
        },
        create: {
          realmId: input.realmId,
          userId: ctx.user.id,
          baseUrl: normalizedEndpoint,
          encryptedKey,
          model: input.model.trim(),
          label: input.label,
          enabled: input.enabled,
        },
        update: {
          // A new key is the saver's; editing around the stored one keeps its adder.
          ...(encryptedKey !== existing?.encryptedKey && { userId: ctx.user.id }),
          baseUrl: normalizedEndpoint,
          encryptedKey,
          model: input.model.trim(),
          enabled: input.enabled,
        },
      });

      let maskedKey = '****';
      try {
        maskedKey = maskApiKey(decryptApiKey(saved.encryptedKey));
      } catch {
        // Fallback
      }

      return {
        id: saved.id,
        baseUrl: saved.baseUrl,
        model: saved.model,
        label: saved.label,
        enabled: saved.enabled,
        maskedKey,
      };
    }),

  /**
   * Delete the Realm's image provider config. Whoever added it, or the Owner.
   */
  delete: protectedProcedure
    .input(z.object({ realmId: z.string().uuid(), id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { role } = await requireRealmRole(ctx, input.realmId, 'ADMIN');
      const existing = await ctx.db.imageProviderConfig.findFirst({
        where: { id: input.id, realmId: input.realmId },
        include: addedBySelect,
      });

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Image provider configuration not found',
        });
      }
      if (!canManageKey(role, existing.userId, ctx.user.id)) {
        throw keyAddedByOtherError(existing.user.name ?? existing.user.email);
      }

      await ctx.db.imageProviderConfig.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),

  /**
   * Test connection to the image provider endpoint without generating an image.
   * Owner/Admin.
   */
  test: protectedProcedure
    .input(z.object({ realmId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireRealmRole(ctx, input.realmId, 'ADMIN');
      const rate = await checkRateLimit('apiKeyTest', ctx.user.id);
      if (!rate.allowed) {
        const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `Too many connection tests. Try again in ${retryIn}s.`,
        });
      }

      const config = await ctx.db.imageProviderConfig.findFirst({
        where: { realmId: input.realmId, enabled: true },
        orderBy: { createdAt: 'desc' },
      });

      if (!config) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'No active image provider configuration found',
        });
      }

      let plaintextKey: string;
      try {
        plaintextKey = decryptApiKey(config.encryptedKey);
      } catch {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'The stored API key could not be read. Save the key again.',
        });
      }

      // Form test endpoint for models check (non-billable)
      let modelsUrl = config.baseUrl;
      if (modelsUrl.endsWith('/images/generations')) {
        modelsUrl = modelsUrl.slice(0, -'/images/generations'.length);
      }
      modelsUrl = `${modelsUrl}/models`;

      try {
        const res = await ssrfFetch(
          'openai',
          modelsUrl,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${plaintextKey}`,
            },
          },
          { validateUrl: true, timeout: 15_000 },
        );

        if (res.ok) {
          return { success: true, message: 'Successfully connected to image provider endpoint' };
        }
        return {
          success: false,
          message: `Endpoint returned status ${res.status}. Base URL and API key saved.`,
        };
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        console.error(`[imageProvider] Connection check failed: ${errMessage}`);
        return {
          success: false,
          message: 'Connection check failed. Configuration saved.',
        };
      }
    }),
});
