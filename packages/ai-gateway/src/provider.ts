import type { AIProvider, AIStreamChunk, AICompletionResponse } from '@app-builder/shared';
import { ProviderError, type ProviderCompleteOptions } from './types';
import type { GatewayMessage, ToolCall } from './tool-calls';
import {
  applyOpenAIToolCallDeltas,
  mapGatewayMessagesToOpenAI,
  parseOpenAIToolCalls,
} from './tool-calls';
import { isObject, isString, safeNumber, safeString } from './guards';
import {
  emptyUsage,
  opencodeHostname,
  parseStreamFrame,
  parseUpstreamError,
  parseUsage,
  requestCompletion,
  ssrfFetch,
  streamingBody,
  toUsage,
  readAnthropicSSE,
  readAnthropicUsage,
  readGeminiUsage,
  readJSONLines,
  readJsonResponse,
  readOllamaUsage,
  readOpenAIUsage,
  readSSEStream,
} from './gateway-http';
import type { PickedApiError } from './gateway-http';

// ─── Gateway HTTP layer ───────────────────────────────────
// Fetch/reader/size-limit infrastructure lives in `./gateway-http`, shared by
// every provider. The public surface of this module is unchanged — the
// re-exports below keep the original symbols and signatures for callers
// (image-client, tests, index.ts) importing from './provider'.
export { ssrfFetch } from './gateway-http';
export {
  readSSEStream,
  readJSONLines,
  readAnthropicSSE,
  readResponseBytes,
  readResponseText,
  readJsonResponse,
} from './gateway-http';
export type { ReadResponseOptions } from './gateway-http';

// ─── Provider Interface ───────────────────────────────────

export interface Provider {
  readonly name: AIProvider;

  /** Non-streaming completion. */
  complete(
    model: string,
    messages: GatewayMessage[],
    apiKey: string,
    options?: ProviderCompleteOptions,
  ): Promise<AICompletionResponse>;

  /**
   * Streaming completion.
   * Yields `AIStreamChunk` objects as content arrives, then returns
   * the final `AICompletionResponse` (with accumulated content and usage).
   */
  stream(
    model: string,
    messages: GatewayMessage[],
    apiKey: string,
    options?: ProviderCompleteOptions,
  ): AsyncGenerator<AIStreamChunk, AICompletionResponse>;

  /** Fetch available models from the provider's API. */
  listModels(apiKey: string, baseUrl?: string, signal?: AbortSignal): Promise<string[]>;
}

// ─── OpenAI-compatible providers (OpenAI, Mistral, Groq) ──

/**
 * Shared base for providers whose /v1/chat/completions endpoint
 * follows OpenAI's request / response / SSE format.
 */
abstract class OpenAICompatibleProvider implements Provider {
  abstract readonly name: AIProvider;
  protected abstract getDefaultBaseUrl(): string;

  /**
   * Strips known endpoint path suffixes from a user-provided base URL.
   * Users naturally enter `https://example.com/v1/chat/completions` but
   * the provider appends its own path segments, so we remove the suffix
   * to produce the API root (`https://example.com/v1`).
   */
  protected normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/chat\/completions\/?$/, '');
  }

  // ── Non-streaming ──

  /** Request an OpenAI-compatible completion, validating custom endpoints and preserving response errors. */
  async complete(
    model: string,
    messages: GatewayMessage[],
    apiKey: string,
    options?: ProviderCompleteOptions,
  ): Promise<AICompletionResponse> {
    const rawBase = options?.baseUrl ?? this.getDefaultBaseUrl();
    const baseUrl = this.normalizeBaseUrl(rawBase);
    const url = `${baseUrl}/chat/completions`;
    // Validate only caller-supplied endpoints. The default base URL is a
    // constant, so validating it buys no SSRF protection while adding a DNS
    // lookup and an undestroyed per-request IP-pinning Agent on every call.
    const hasCustomEndpoint = options?.baseUrl !== undefined;
    const response = await requestCompletion(this.name, url, {
      headers: this.authHeaders(apiKey, { url, sessionId: options?.sessionId }),
      payload: this.buildPayload(model, messages, options, false),
      validateUrl: hasCustomEndpoint,
      stream: false,
      signal: options?.signal,
    });

    if (!response.ok) {
      throw await this.parseError(response);
    }

    const data = await readJsonResponse(this.name, response);
    return this.parseNonStreamingResponse(data);
  }

  // ── Streaming ──

  /** Yield OpenAI-compatible streaming chunks and return the accumulated completion and usage. */
  async *stream(
    model: string,
    messages: GatewayMessage[],
    apiKey: string,
    options?: ProviderCompleteOptions,
  ): AsyncGenerator<AIStreamChunk, AICompletionResponse> {
    const rawBase = options?.baseUrl ?? this.getDefaultBaseUrl();
    const baseUrl = this.normalizeBaseUrl(rawBase);
    const url = `${baseUrl}/chat/completions`;
    const hasCustomEndpoint = options?.baseUrl !== undefined;
    const response = await requestCompletion(this.name, url, {
      headers: this.authHeaders(apiKey, { url, sessionId: options?.sessionId }),
      payload: this.buildPayload(model, messages, options, true),
      validateUrl: hasCustomEndpoint,
      stream: true,
      signal: options?.signal,
    });

    if (!response.ok) {
      throw await this.parseError(response);
    }

    // Cap streaming response body size to prevent resource exhaustion
    const body = streamingBody(response);

    let accumulatedContent = '';
    let accumulatedReasoning = '';
    let accumulatedToolCalls: ToolCall[] = [];
    let finishReason: string = 'stop';
    let finalUsage = emptyUsage();

    for await (const raw of readSSEStream(body)) {
      const parsed = parseStreamFrame(raw);
      if (parsed === null) continue;

      // usage in final chunk (OpenAI with stream_options.include_usage)
      const usageRaw = parsed['usage'];
      if (isObject(usageRaw)) {
        finalUsage = toUsage(readOpenAIUsage(usageRaw));
      }

      const choices = parsed['choices'];
      if (!Array.isArray(choices)) continue;

      for (const choice of choices) {
        if (!isObject(choice)) continue;
        const delta = choice['delta'];
        if (!isObject(delta)) continue;

        // Some reasoning models (e.g. DeepSeek, Kimi) return content in
        // `reasoning_content` and leave `content` empty. Track it separately.
        const content = safeString(delta['content']) || '';
        const reasoningContent =
          safeString(delta['reasoning_content']) ||
          safeString(delta['reasoning']) ||
          safeString(delta['reasoning_text']) ||
          safeString(delta['thought']) ||
          '';

        if (reasoningContent) {
          accumulatedReasoning += reasoningContent;
        }

        const rawFinish = choice['finish_reason'];
        if (rawFinish === 'stop' || rawFinish === 'length' || rawFinish === 'tool_calls') {
          finishReason = rawFinish;
        }

        const toolDeltas = delta['tool_calls'];
        let toolCallsUpdated = false;
        if (Array.isArray(toolDeltas) && toolDeltas.length > 0) {
          accumulatedToolCalls = applyOpenAIToolCallDeltas(accumulatedToolCalls, toolDeltas);
          toolCallsUpdated = true;
          if (finishReason === 'stop') finishReason = 'tool_calls';
        }

        // Yield reasoning content if present (won't overlap with text)
        if (reasoningContent) {
          yield { content: '', reasoning: reasoningContent };
        }

        // text content
        if (content !== '') {
          accumulatedContent += content;
          const chunk: AIStreamChunk = { content };
          if (finishReason !== 'stop') chunk.finishReason = finishReason;
          yield chunk;
        } else if (toolCallsUpdated) {
          yield {
            content: '',
            finishReason,
            toolCalls: accumulatedToolCalls,
          };
        }
      }
    }

    return {
      content: accumulatedContent,
      reasoning: accumulatedReasoning || undefined,
      finishReason,
      toolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
      usage: finalUsage,
    };
  }

  // ── Shared helpers ──

  protected authHeaders(
    apiKey: string,
    request?: { url: string; sessionId?: string },
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    };
    if (request?.sessionId && opencodeHostname(request.url)) {
      headers['x-opencode-session'] = request.sessionId;
    }
    return headers;
  }

  protected buildPayload(
    model: string,
    messages: GatewayMessage[],
    options?: ProviderCompleteOptions,
    stream?: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages: mapGatewayMessagesToOpenAI(messages),
      stream: stream ?? false,
    };
    if (options?.maxTokens !== undefined) {
      body['max_tokens'] = options.maxTokens;
      body['max_completion_tokens'] = options.maxTokens;
    }
    if (options?.temperature !== undefined) body['temperature'] = options.temperature;
    if (options?.reasoningEffort !== undefined) {
      body['reasoning_effort'] =
        options.reasoningEffort === 'off' ? 'none' : options.reasoningEffort;
    }
    if (options?.tools !== undefined && options.tools.length > 0) {
      body['tools'] = options.tools;
    }
    if (options?.toolChoice !== undefined) {
      body['tool_choice'] = options.toolChoice;
    }
    if (stream) {
      body['stream_options'] = { include_usage: true };
    }
    return body;
  }

  protected async parseError(response: Response): Promise<ProviderError> {
    return parseUpstreamError(this.name, response, openAIErrorBody);
  }

  protected parseNonStreamingResponse(data: unknown): AICompletionResponse {
    if (!isObject(data)) {
      throw new Error('OpenAI-compatible response is not an object');
    }

    const choices = data['choices'];
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new Error('No choices in OpenAI-compatible response');
    }

    const choice = choices[0];
    if (!isObject(choice)) {
      throw new Error('First choice is not an object');
    }

    const message = choice['message'];
    if (!isObject(message)) {
      throw new Error('No message object in choice');
    }

    // Some reasoning models (e.g. DeepSeek, Kimi) return content in
    // `reasoning_content` and leave `content` empty. Fall back to it.
    let content = safeString(message['content']);
    if (!content) {
      const reasoning = message['reasoning_content'];
      if (isString(reasoning)) content = reasoning;
    }
    const finishReason: string = safeString(choice['finish_reason']) || 'stop';
    const toolCalls = parseOpenAIToolCalls(message['tool_calls']);

    const rawUsage = data['usage'];
    const usage = parseUsage(rawUsage, readOpenAIUsage);

    return {
      content,
      finishReason: toolCalls.length > 0 && finishReason === 'stop' ? 'tool_calls' : finishReason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
    };
  }

  /** Fetch and sort model IDs from the default or SSRF-validated custom OpenAI-compatible endpoint. */
  async listModels(apiKey: string, baseUrl?: string, signal?: AbortSignal): Promise<string[]> {
    const rawBase = baseUrl ?? this.getDefaultBaseUrl();
    const normalized = this.normalizeBaseUrl(rawBase);
    const url = `${normalized}/models`;
    const hasCustomEndpoint = baseUrl !== undefined;
    const response = await ssrfFetch(
      this.name,
      url,
      {
        headers: this.authHeaders(apiKey),
      },
      { validateUrl: hasCustomEndpoint, signal },
    );
    if (!response.ok) {
      throw await this.parseError(response);
    }

    const data = await readJsonResponse(this.name, response);
    if (!isObject(data)) throw new Error('Invalid models response');

    const rawData = data['data'];
    if (!Array.isArray(rawData)) throw new Error('No data array in models response');

    return rawData
      .filter(isObject)
      .map((m) => safeString(m['id']))
      .filter((id) => id.length > 0)
      .sort();
  }
}

// ─── OpenAI ────────────────────────────────────────────────

export class OpenAIProvider extends OpenAICompatibleProvider {
  readonly name: AIProvider = 'openai';
  protected getDefaultBaseUrl(): string {
    return 'https://api.openai.com/v1';
  }
}

// ─── Mistral ───────────────────────────────────────────────

export class MistralProvider extends OpenAICompatibleProvider {
  readonly name: AIProvider = 'mistral';
  protected getDefaultBaseUrl(): string {
    return 'https://api.mistral.ai/v1';
  }
}

// ─── Groq ──────────────────────────────────────────────────

export class GroqProvider extends OpenAICompatibleProvider {
  readonly name: AIProvider = 'groq';
  protected getDefaultBaseUrl(): string {
    return 'https://api.groq.com/openai/v1';
  }
}

// ─── Anthropic ─────────────────────────────────────────────

export class AnthropicProvider implements Provider {
  readonly name: AIProvider = 'anthropic';

  /** Request an Anthropic completion, validating custom endpoints and preserving response errors. */
  async complete(
    model: string,
    messages: GatewayMessage[],
    apiKey: string,
    options?: ProviderCompleteOptions,
  ): Promise<AICompletionResponse> {
    const baseUrl = options?.baseUrl ?? 'https://api.anthropic.com/v1';
    const url = `${baseUrl}/messages`;
    const hasCustomEndpoint = options?.baseUrl !== undefined;
    const response = await requestCompletion(this.name, url, {
      headers: this.headers(apiKey),
      payload: this.buildPayload(model, messages, options, false),
      validateUrl: hasCustomEndpoint,
      stream: false,
      signal: options?.signal,
    });

    if (!response.ok) {
      throw await this.parseError(response);
    }

    const data = await readJsonResponse(this.name, response);
    return this.parseNonStreamingResponse(data);
  }
  // ── Streaming ──

  /** Yield Anthropic streaming chunks and return the accumulated completion and usage. */
  async *stream(
    model: string,
    messages: GatewayMessage[],
    apiKey: string,
    options?: ProviderCompleteOptions,
  ): AsyncGenerator<AIStreamChunk, AICompletionResponse> {
    const baseUrl = options?.baseUrl ?? 'https://api.anthropic.com/v1';
    const url = `${baseUrl}/messages`;
    const hasCustomEndpoint = options?.baseUrl !== undefined;
    const response = await requestCompletion(this.name, url, {
      headers: this.headers(apiKey),
      payload: this.buildPayload(model, messages, options, true),
      validateUrl: hasCustomEndpoint,
      stream: true,
      signal: options?.signal,
    });

    if (!response.ok) {
      throw await this.parseError(response);
    }

    // Cap streaming body size for SSRF/memory protection
    const body = streamingBody(response);
    let accumulatedContent = '';
    let accumulatedReasoning = '';
    let finalUsage = emptyUsage();
    let finishReason: AIStreamChunk['finishReason'];

    for await (const { event, data: raw } of readAnthropicSSE(body)) {
      const parsed = parseStreamFrame(raw);
      if (parsed === null) continue;

      switch (event) {
        case 'message_start': {
          const msg = parsed['message'];
          if (isObject(msg)) {
            const usageRaw = msg['usage'];
            if (isObject(usageRaw)) {
              finalUsage = toUsage(readAnthropicUsage(usageRaw));
            }
          }
          break;
        }

        case 'content_block_delta': {
          const delta = parsed['delta'];
          if (!isObject(delta)) break;
          const text = safeString(delta['text']);
          const thinking = safeString(delta['thinking']);
          if (thinking !== '') {
            accumulatedReasoning += thinking;
            yield { content: '', reasoning: thinking };
          }
          if (text !== '') {
            accumulatedContent += text;
            yield { content: text };
          }
          break;
        }

        case 'message_delta': {
          const delta = parsed['delta'];
          if (isObject(delta)) {
            const stopReason = delta['stop_reason'];
            if (
              stopReason === 'end_turn' ||
              stopReason === 'max_tokens' ||
              stopReason === 'tool_use'
            ) {
              finishReason =
                stopReason === 'end_turn'
                  ? 'stop'
                  : stopReason === 'max_tokens'
                    ? 'length'
                    : 'tool_calls';
            }
          }
          const usageRaw = parsed['usage'];
          if (isObject(usageRaw)) {
            const outputTokens = safeNumber(usageRaw['output_tokens']);
            finalUsage = {
              ...finalUsage,
              completionTokens: outputTokens,
              totalTokens: finalUsage.promptTokens + outputTokens,
            };
          }
          break;
        }

        default:
          break;
      }
    }

    if (finishReason) {
      yield { content: '', finishReason };
    }

    return {
      content: accumulatedContent,
      reasoning: accumulatedReasoning || undefined,
      finishReason: finishReason ?? 'stop',
      usage: finalUsage,
    };
  }

  private headers(apiKey: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    };
  }

  private buildPayload(
    model: string,
    messages: GatewayMessage[],
    options?: ProviderCompleteOptions,
    stream?: boolean,
  ): Record<string, unknown> {
    // The Anthropic Messages API only accepts `user`/`assistant` roles in
    // `messages`; system instructions must be sent as the top-level `system`
    // field. Sending `role: 'system'` inside `messages` is a 400.
    let system: string | undefined;
    const rest: GatewayMessage[] = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        system = msg.content;
      } else {
        rest.push(msg);
      }
    }

    const body: Record<string, unknown> = {
      model,
      max_tokens: options?.maxTokens ?? 16384,
      messages: rest,
      stream: stream ?? false,
    };
    if (system !== undefined) body['system'] = system;
    if (options?.temperature !== undefined) body['temperature'] = options.temperature;
    return body;
  }

  private async parseError(response: Response): Promise<ProviderError> {
    return parseUpstreamError(this.name, response, anthropicErrorBody);
  }

  private parseNonStreamingResponse(data: unknown): AICompletionResponse {
    if (!isObject(data)) throw new Error('Anthropic response is not an object');

    const contentBlocks = data['content'];
    const content = Array.isArray(contentBlocks)
      ? contentBlocks
          .filter(isObject)
          .map((b) => safeString(b['text']))
          .join('')
      : '';

    const rawUsage = data['usage'];
    const usage = parseUsage(rawUsage, readAnthropicUsage);

    return { content, finishReason: 'stop', usage };
  }

  /** Fetch sorted model IDs from the fixed Anthropic endpoint; the base URL argument is ignored. */
  async listModels(apiKey: string, _baseUrl?: string, signal?: AbortSignal): Promise<string[]> {
    const url = 'https://api.anthropic.com/v1/models';
    const response = await ssrfFetch(
      this.name,
      url,
      {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      },
      // `_baseUrl` is not honoured — this endpoint is a constant, so there is
      // nothing caller-supplied to validate.
      { signal },
    );

    if (!response.ok) {
      throw await this.parseError(response);
    }
    const data = await readJsonResponse(this.name, response);
    if (!isObject(data)) throw new Error('Invalid models response');
    const rawData = data['data'];
    if (!Array.isArray(rawData)) return [];
    return rawData
      .filter(isObject)
      .map((m) => safeString(m['id']))
      .filter((id) => id.length > 0)
      .sort();
  }
}

// ─── Google Gemini ─────────────────────────────────────────

export class GoogleProvider implements Provider {
  readonly name: AIProvider = 'google';

  /** Request a Gemini completion, validating custom endpoints and preserving response errors. */
  async complete(
    model: string,
    messages: GatewayMessage[],
    apiKey: string,
    options?: ProviderCompleteOptions,
  ): Promise<AICompletionResponse> {
    const baseUrl = options?.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    const url = `${baseUrl}/models/${model}:generateContent`;
    const hasCustomEndpoint = options?.baseUrl !== undefined;

    const response = await requestCompletion(this.name, url, {
      headers: this.headers(apiKey),
      payload: this.buildPayload(messages, options),
      validateUrl: hasCustomEndpoint,
      stream: false,
      signal: options?.signal,
    });

    if (!response.ok) {
      throw await this.parseError(response);
    }

    const data = await readJsonResponse(this.name, response);
    return this.parseResponse(data);
  }

  // ── Streaming ──

  async *stream(
    model: string,
    messages: GatewayMessage[],
    apiKey: string,
    options?: ProviderCompleteOptions,
  ): AsyncGenerator<AIStreamChunk, AICompletionResponse> {
    const baseUrl = options?.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    const url = `${baseUrl}/models/${model}:streamGenerateContent?alt=sse`;
    const hasCustomEndpoint = options?.baseUrl !== undefined;

    const response = await requestCompletion(this.name, url, {
      headers: this.headers(apiKey),
      payload: this.buildPayload(messages, options),
      validateUrl: hasCustomEndpoint,
      stream: true,
      signal: options?.signal,
    });

    if (!response.ok) {
      throw await this.parseError(response);
    }

    // Cap streaming body size for SSRF/memory protection
    const body = streamingBody(response);

    let accumulatedContent = '';
    let finishReason: AIStreamChunk['finishReason'] = 'stop';
    let finalUsage = emptyUsage();

    for await (const raw of readSSEStream(body)) {
      const parsed = parseStreamFrame(raw);
      if (parsed === null) continue;

      // usage metadata
      const usageRaw = parsed['usageMetadata'];
      if (isObject(usageRaw)) {
        finalUsage = toUsage(readGeminiUsage(usageRaw));
      }

      const candidates = parsed['candidates'];
      if (!Array.isArray(candidates) || candidates.length === 0) continue;

      const candidate = candidates[0];
      if (!isObject(candidate)) continue;

      const contentObj = candidate['content'];
      if (!isObject(contentObj)) continue;

      const parts = contentObj['parts'];
      if (!Array.isArray(parts)) continue;

      for (const part of parts) {
        if (!isObject(part)) continue;
        const text = safeString(part['text']);
        if (text !== '') {
          accumulatedContent += text;
          yield { content: text };
        }
      }

      // finish reason
      const rawFinish = candidate['finishReason'];
      if (
        isString(rawFinish) &&
        (rawFinish === 'STOP' || rawFinish === 'MAX_TOKENS' || rawFinish === 'SAFETY')
      ) {
        const mapped: AIStreamChunk['finishReason'] =
          rawFinish === 'STOP' ? 'stop' : rawFinish === 'MAX_TOKENS' ? 'length' : 'stop'; // SAFETY → treat as stop from our perspective
        finishReason = mapped;
        yield { content: '', finishReason: mapped };
      }
    }

    return {
      content: accumulatedContent,
      finishReason,
      usage: finalUsage,
    };
  }

  private headers(apiKey: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    };
  }

  private buildPayload(
    messages: GatewayMessage[],
    options?: ProviderCompleteOptions,
  ): Record<string, unknown> {
    // Google uses "contents" array with role mapping
    // System instructions go in system_instruction field
    let systemInstruction: string | undefined;
    const contents: Record<string, unknown>[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = msg.content;
      } else {
        const role = msg.role === 'assistant' ? 'model' : 'user';
        contents.push({
          role,
          parts: [{ text: msg.content }],
        });
      }
    }

    const body: Record<string, unknown> = { contents };
    if (systemInstruction !== undefined) {
      body['system_instruction'] = { parts: [{ text: systemInstruction }] };
    }

    const genConfig: Record<string, unknown> = {};
    if (options?.maxTokens !== undefined) genConfig['maxOutputTokens'] = options.maxTokens;
    if (options?.temperature !== undefined) genConfig['temperature'] = options.temperature;
    if (Object.keys(genConfig).length > 0) {
      body['generationConfig'] = genConfig;
    }

    return body;
  }

  private async parseError(response: Response): Promise<ProviderError> {
    return parseUpstreamError(this.name, response, googleErrorBody);
  }

  private parseResponse(data: unknown): AICompletionResponse {
    if (!isObject(data)) throw new Error('Google response is not an object');

    const candidates = data['candidates'];
    if (!Array.isArray(candidates) || candidates.length === 0) {
      // blocked / empty response — return empty content
      const usage = parseUsage(data['usageMetadata'], readGeminiUsage);
      return { content: '', finishReason: 'stop', usage };
    }

    const candidate = candidates[0];
    if (!isObject(candidate)) throw new Error('First candidate is not an object');

    const contentObj = candidate['content'];
    if (!isObject(contentObj)) throw new Error('No content in candidate');

    const parts = contentObj['parts'];
    const content = Array.isArray(parts)
      ? parts
          .filter(isObject)
          .map((p) => safeString(p['text']))
          .join('')
      : '';

    const rawUsage = data['usageMetadata'];
    const usage = parseUsage(rawUsage, readGeminiUsage);

    return { content, finishReason: 'stop', usage };
  }

  /** Fetch sorted Gemini model IDs with the models/ prefix removed, validating custom endpoints. */
  async listModels(apiKey: string, baseUrl?: string, signal?: AbortSignal): Promise<string[]> {
    const rawBase = baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    const url = `${rawBase}/models`;
    const hasCustomEndpoint = baseUrl !== undefined;

    const response = await ssrfFetch(
      this.name,
      url,
      {
        headers: this.headers(apiKey),
      },
      { validateUrl: hasCustomEndpoint, signal },
    );

    if (!response.ok) {
      throw await this.parseError(response);
    }

    const data = await readJsonResponse(this.name, response);
    if (!isObject(data)) throw new Error('Invalid models response');
    const rawData = data['models'];
    if (!Array.isArray(rawData)) return [];
    return rawData
      .filter(isObject)
      .map((m) => {
        const name = safeString(m['name']);
        return name.replace(/^models\//, '');
      })
      .filter((id) => id.length > 0)
      .sort();
  }
}

// ─── Ollama ────────────────────────────────────────────────

export class OllamaProvider implements Provider {
  readonly name: AIProvider = 'ollama';

  /** Request an Ollama completion, enforcing SSRF and loopback policy even for the default endpoint. */
  async complete(
    model: string,
    messages: GatewayMessage[],
    _apiKey: string,
    options?: ProviderCompleteOptions,
  ): Promise<AICompletionResponse> {
    // Ollama doesn't use API key; `apiKey` param is ignored.
    // Always validate: the default endpoint is loopback, which is exactly what
    // validateUrl() gates behind ALLOW_LOOPBACK_PROVIDERS — a default must not
    // silently bypass that policy.
    const baseUrl = options?.baseUrl ?? 'http://localhost:11434';

    const response = await requestCompletion(this.name, `${baseUrl}/api/chat`, {
      headers: { 'Content-Type': 'application/json' },
      payload: this.buildPayload(model, messages, options, false),
      validateUrl: true,
      stream: false,
      signal: options?.signal,
    });

    if (!response.ok) {
      throw await this.parseError(response);
    }

    const data = await readJsonResponse(this.name, response);
    return this.parseResponse(data);
  }

  async *stream(
    model: string,
    messages: GatewayMessage[],
    _apiKey: string,
    options?: ProviderCompleteOptions,
  ): AsyncGenerator<AIStreamChunk, AICompletionResponse> {
    const baseUrl = options?.baseUrl ?? 'http://localhost:11434';

    const response = await requestCompletion(this.name, `${baseUrl}/api/chat`, {
      headers: { 'Content-Type': 'application/json' },
      payload: this.buildPayload(model, messages, options, true),
      validateUrl: true,
      stream: true,
      signal: options?.signal,
    });

    if (!response.ok) {
      throw await this.parseError(response);
    }

    const body = streamingBody(response);

    let accumulatedContent = '';
    let finishReason: AIStreamChunk['finishReason'] = 'stop';
    let finalUsage = emptyUsage();

    for await (const raw of readJSONLines(body)) {
      const parsed = parseStreamFrame(raw);
      if (parsed === null) continue;

      const msg = parsed['message'];
      if (isObject(msg)) {
        const text = safeString(msg['content']);
        if (text !== '') {
          accumulatedContent += text;
          yield { content: text };
        }
      }

      if (parsed['done'] === true) {
        finalUsage = toUsage(readOllamaUsage(parsed));
        const doneReason = safeString(parsed['done_reason']);
        if (doneReason === 'length' || doneReason === 'max_tokens') {
          finishReason = 'length';
        }
      }
    }

    return {
      content: accumulatedContent,
      finishReason,
      usage: finalUsage,
    };
  }

  private buildPayload(
    model: string,
    messages: GatewayMessage[],
    options?: ProviderCompleteOptions,
    stream?: boolean,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model,
      messages,
      stream: stream ?? false,
    };
    const opts: Record<string, unknown> = {};
    if (options?.temperature !== undefined) opts['temperature'] = options.temperature;
    if (options?.maxTokens !== undefined) opts['num_predict'] = options.maxTokens;
    if (Object.keys(opts).length > 0) body['options'] = opts;
    return body;
  }

  private async parseError(response: Response): Promise<ProviderError> {
    return parseUpstreamError(this.name, response, ollamaErrorBody);
  }

  private parseResponse(data: unknown): AICompletionResponse {
    if (!isObject(data)) throw new Error('Ollama response is not an object');

    const msg = data['message'];
    const content = isObject(msg) ? safeString(msg['content']) : '';

    const usage = toUsage(readOllamaUsage(data));

    return { content, finishReason: 'stop', usage };
  }

  /** Fetch sorted Ollama model names, enforcing SSRF and loopback policy; the API key is unused. */
  async listModels(_apiKey: string, baseUrl?: string, signal?: AbortSignal): Promise<string[]> {
    const url = `${baseUrl ?? 'http://localhost:11434'}/api/tags`;
    // validateUrl: true — the default endpoint is loopback and must go through
    // the same ALLOW_LOOPBACK_PROVIDERS gate as a custom one.
    const response = await ssrfFetch(this.name, url, undefined, {
      validateUrl: true,
      signal,
    });
    if (!response.ok)
      throw new ProviderError(
        this.name,
        response.status,
        'unknown',
        'Failed to fetch Ollama models',
      );
    const data = await readJsonResponse(this.name, response);
    if (!isObject(data)) throw new Error('Invalid Ollama models response');
    const rawData = data['models'];
    if (!Array.isArray(rawData)) return [];
    return rawData
      .filter(isObject)
      .map((m) => safeString(m['name']))
      .filter((id) => id.length > 0)
      .sort();
  }
}

// ─── Custom (OpenAI Compatible) ────────────────────────────

export class CustomProvider extends OpenAICompatibleProvider {
  readonly name: AIProvider = 'custom';

  protected getDefaultBaseUrl(): string {
    throw new ProviderError(
      this.name,
      0,
      'missing_base_url',
      'Custom providers require a base URL.',
    );
  }
}

// ─── Error-body dialects ──────────────────────────────────

/**
 * OpenAI-compatible envelopes carry `error.message`; the code comes from
 * `error.code` or — the assignment after it wins — `error.type`.
 */
function openAIErrorBody(body: Record<string, unknown>): PickedApiError | undefined {
  const error = body['error'];
  if (!isObject(error)) return undefined;
  const picked: PickedApiError = {};
  if (isString(error['message'])) picked.message = error['message'];
  if (isString(error['code'])) picked.code = error['code'];
  if (isString(error['type'])) picked.code = error['type'];
  return picked;
}

/** Anthropic errors carry `error.message` and a bare `error.type` code. */
function anthropicErrorBody(body: Record<string, unknown>): PickedApiError | undefined {
  const error = body['error'];
  if (!isObject(error)) return undefined;
  const picked: PickedApiError = {};
  if (isString(error['message'])) picked.message = error['message'];
  if (isString(error['type'])) picked.code = error['type'];
  return picked;
}

/**
 * Gemini errors carry `error.message`, optionally a string `error.status`
 * and/or a numeric `error.code`; both assignments run independently, so a
 * numeric code wins when both are present.
 */
function googleErrorBody(body: Record<string, unknown>): PickedApiError | undefined {
  const error = body['error'];
  if (!isObject(error)) return undefined;
  const picked: PickedApiError = {};
  if (isString(error['message'])) picked.message = error['message'];
  if (isString(error['status'])) picked.code = error['status'];
  if (typeof error['code'] === 'number') picked.code = String(error['code']);
  return picked;
}

/**
 * Ollama returns its error message as a bare string field rather than an
 * envelope; the code stays the shared parser's `'unknown'` default.
 */
function ollamaErrorBody(body: Record<string, unknown>): PickedApiError | undefined {
  const picked: PickedApiError = {};
  if (isString(body['error'])) picked.message = body['error'];
  return picked;
}

// ─── Registry ──────────────────────────────────────────────
const providerRegistry: Record<AIProvider, Provider> = {
  openai: new OpenAIProvider(),
  anthropic: new AnthropicProvider(),
  google: new GoogleProvider(),
  mistral: new MistralProvider(),
  groq: new GroqProvider(),
  ollama: new OllamaProvider(),
  custom: new CustomProvider(),
};

/**
 * Returns the provider instance for a given provider name.
 */
export function getProvider(name: AIProvider): Provider {
  return providerRegistry[name];
}
