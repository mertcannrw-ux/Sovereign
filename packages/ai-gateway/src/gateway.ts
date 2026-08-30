import type { AICompletionRequest, AICompletionResponse, AIStreamChunk } from '@app-builder/shared';
import { getProvider } from './provider';

/**
 * High-level AI Gateway that routes requests to the correct provider
 * using the user's stored BYOK API key.
 *
 * Usage:
 * ```ts
 * const gateway = new Gateway();
 * const response = await gateway.complete({
 *   provider: 'openai',
 *   model: selectedModel,
 *   messages: [{ role: 'user', content: 'Hello' }],
 *   apiKey: 'sk-...',
 * });
 * ```
 */
export class Gateway {
  /**
   * Send a non-streaming completion request.
   *
   * @param request - Standardized completion request.
   * @param apiKey - The user's BYOK API key for the chosen provider.
   * @param baseUrl - Optional base URL override (required for Ollama,
   *                  useful for proxies / self-hosted endpoints).
   * @returns A typed `AICompletionResponse` with content and token usage.
   * @throws {ProviderError} On provider API errors (invalid key, rate limit, etc.).
   */
  async complete(
    request: AICompletionRequest,
    apiKey: string,
    baseUrl?: string,
  ): Promise<AICompletionResponse> {
    const provider = getProvider(request.provider);

    return provider.complete(request.model, request.messages, apiKey, {
      baseUrl,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      tools: request.tools,
      toolChoice: request.toolChoice,
    });
  }

  /**
   * Send a streaming completion request.
   *
   * Yields typed `AIStreamChunk` objects as content arrives. After the
   * for-await loop finishes, the generator returns the final
   * `AICompletionResponse` with accumulated content and token usage.
   *
   * **Important:** Always consume the generator fully (even on early
   * cancellation) so the underlying HTTP connection is closed cleanly.
   *
   * ```ts
   * const gateway = new Gateway();
   * const gen = gateway.stream(
   *   { provider: selectedProvider, model: selectedModel, messages: [...], stream: true },
   *   'sk-...',
   * );
   * let result: AICompletionResponse;
   * for await (const chunk of gen) {
   *   processChunk(chunk);
   * }
   * ```
   *
   * @param request - Standardized completion request (stream flag is forwarded).
   * @param apiKey - The user's BYOK API key for the chosen provider.
   * @param baseUrl - Optional base URL override.
   * @returns An async generator yielding `AIStreamChunk` and returning an
   *          `AICompletionResponse` on completion.
   * @throws {ProviderError} On provider API errors.
   */
  async *stream(
    request: AICompletionRequest,
    apiKey: string,
    baseUrl?: string,
  ): AsyncGenerator<AIStreamChunk, AICompletionResponse> {
    const provider = getProvider(request.provider);

    const result = yield* provider.stream(request.model, request.messages, apiKey, {
      baseUrl,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      tools: request.tools,
      toolChoice: request.toolChoice,
    });

    return result;
  }
}

export { ProviderError } from './types';
export { getProvider } from './provider';
export type { Provider } from './provider';
