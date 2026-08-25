import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { normalizeImageEndpoint, ssrfFetch } from '@app-builder/ai-gateway';
import { protectedProcedure, router } from '../trpc';
import { encryptApiKey, decryptApiKey, maskApiKey } from '@/lib/crypto';
import { checkRateLimit } from '@/server/rate-limit';

export const imageProviderRouter = router({
  /**
   * Get the current user's image provider config.
   */
  get: protectedProcedure.query(async ({ ctx }) => {
    const config = await ctx.db.imageProviderConfig.findFirst({
      where: { userId: ctx.user.id },
      orderBy: { createdAt: 'desc' },
    });

    if (!config) return null;

    let maskedKey = '****';
    try {
      const plaintext = decryptApiKey(config.encryptedKey);
      maskedKey = maskApiKey(plaintext);
    } catch {
      // Keep masked fallback
    }

    return {
      id: config.id,
      baseUrl: config.baseUrl,
      model: config.model,
      label: config.label,
      enabled: config.enabled,
      maskedKey,
      createdAt: config.createdAt,
      lastUsedAt: config.lastUsedAt,
    };
  }),

  /**
   * Save (upsert) the current user's image provider config.
   */
  save: protectedProcedure
    .input(
      z.object({
        baseUrl: z.string().min(1),
        apiKey: z.string().optional(),
        model: z.string().min(1).default('dall-e-3'),
        label: z.string().optional().default('default'),
        enabled: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      let normalizedBaseUrl = input.baseUrl.trim();
      if (!normalizedBaseUrl.startsWith('http://') && !normalizedBaseUrl.startsWith('https://')) {
        normalizedBaseUrl = `https://${normalizedBaseUrl}`;
      }
      // Validate endpoint structure
      try {
        new URL(normalizedBaseUrl);
      } catch {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Invalid base URL provided',
        });
      }

      const normalizedEndpoint = normalizeImageEndpoint(normalizedBaseUrl);

      const existing = await ctx.db.imageProviderConfig.findFirst({
        where: { userId: ctx.user.id, label: input.label },
      });

      let encryptedKey: string;
      if (input.apiKey && input.apiKey.trim().length > 0) {
        encryptedKey = encryptApiKey(input.apiKey.trim());
      } else if (existing) {
        encryptedKey = existing.encryptedKey;
      } else {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'API Key is required for new image provider configuration',
        });
      }

      const saved = await ctx.db.imageProviderConfig.upsert({
        where: {
          userId_label: {
            userId: ctx.user.id,
            label: input.label,
          },
        },
        create: {
          userId: ctx.user.id,
          baseUrl: normalizedEndpoint,
          encryptedKey,
          model: input.model.trim(),
          label: input.label,
          enabled: input.enabled,
        },
        update: {
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
   * Delete the current user's image provider config.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.imageProviderConfig.findFirst({
        where: { id: input.id, userId: ctx.user.id },
      });

      if (!existing) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Image provider configuration not found',
        });
      }

      await ctx.db.imageProviderConfig.delete({
        where: { id: input.id },
      });

      return { success: true };
    }),

  /**
   * Test connection to the image provider endpoint without generating an image.
   */
  test: protectedProcedure.mutation(async ({ ctx }) => {
    const rate = await checkRateLimit('apiKeyTest', ctx.user.id);
    if (!rate.allowed) {
      const retryIn = Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000));
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: `Too many connection tests. Try again in ${retryIn}s.`,
      });
    }

    const config = await ctx.db.imageProviderConfig.findFirst({
      where: { userId: ctx.user.id, enabled: true },
    });

    if (!config) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'No active image provider configuration found',
      });
    }
    const plaintextKey = decryptApiKey(config.encryptedKey);

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
