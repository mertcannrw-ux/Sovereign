import type { AIProvider, AIStreamChunk, AICompletionResponse } from '@app-builder/shared';
import { ProviderError, type ProviderCompleteOptions } from './types';
import type { GatewayMessage, ToolCall } from './tool-calls';
import {
  applyOpenAIToolCallDeltas,
  mapGatewayMessagesToOpenAI,
  parseOpenAIToolCalls,
} from './tool-calls';
import { SsrfError, validateOutboundUrl } from './ssrf';
import type { Dispatcher } from 'undici';

// ─── Helpers ──────────────────────────────────────────────
// All type-guarded to comply with the no-inline-cast-access rule.

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function safeString(value: unknown, fallback = ''): string {
  return isString(value) ? value : fallback;
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
}

/**
 * Builds an undici dispatcher that connects to `pinnedIp` while keeping the
 * requested hostname as the TLS SNI (servername). This pins the validated IP
 * to defeat DNS-rebinding TOCTOU without rewriting the URL host — rewriting the
 * host would change the SNI and break SNI-based virtual hosting (regression N-2).
 */
function createPinnedIpDispatcher(parsed: URL, pinnedIp: string): Dispatcher {
  // Lazy-load undici so the module works in environments where it is unavailable.
  // undici ships with Node 18+ and is present in this monorepo's root deps.
  const undici = require('undici') as typeof import('undici');
  const { Agent, buildConnector } = undici;
  const https = parsed.protocol === 'https:';
  const baseConnector = buildConnector({ timeout: 10_000 });
  // Route the connection to the validated IP while preserving the original
  // hostname as the TLS SNI (servername) — this is what defeats DNS-rebinding
  // TOCTOU without breaking SNI-based virtual hosting (N-2).
  const connect: typeof baseConnector = (opts, cb) =>
    baseConnector(
      {
        ...opts,
        host: pinnedIp,
        hostname: pinnedIp,
        servername: https ? parsed.hostname : undefined,
      } as Parameters<typeof baseConnector>[0],
      cb,
    );
  return new Agent({ connect }) as unknown as Dispatcher;
}

/**
 * Inactivity deadline for one stream read. `ssrfFetch` clears its timer once
 * the response headers arrive, so a peer that stops sending mid-body would
 * otherwise stall the agent run — and hold its project lease — until the
 * platform kills the function. Rejects when no chunk arrives in the window;
 * the caller's `finally` cancels the reader, closing the socket.
 */
function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  // Start the read first: `read()` can throw synchronously (released reader),
  // and arming the timer before that point would leak a promise that rejects
  // with no handler once it fires.
  const read = reader.read();
  // The deadline can win the race; mark the losing read as handled so the
  // cancellation in the caller's `finally` cannot surface as an unhandled
  // rejection.
  read.catch(() => {});
  // Timer handle captured through a closure so the type never has to be named.
  let clearTimer = () => {};
  const expired = new Promise<never>((_, reject) => {
    const timerId = setTimeout(
      () => reject(new Error(`Stream idle for ${idleTimeoutMs}ms without data`)),
      idleTimeoutMs,
    );
    clearTimer = () => clearTimeout(timerId);
  });
  return Promise.race([read, expired]).finally(clearTimer);
}

/**
 * Reads a `ReadableStream<Uint8Array>` and yields each `data:` line
 * as a decoded string, stripping the prefix. The standard SSE format
 * used by OpenAI, Mistral, Groq, and (with `alt=sse`) Google.
 *
 * Exported so the framing rules (unterminated final event, `data:` with or
 * without a space, split multi-byte characters) can be tested directly.
 */
export async function* readSSEStream(
  body: ReadableStream<Uint8Array>,
  idleTimeoutMs = STREAM_IDLE_TIMEOUT_MS,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Shared by the read loop and the final flush. The last event of a stream is
  // frequently not newline-terminated; parsing the residual buffer inline would
  // duplicate these rules and let the two copies drift apart.
  function* parseLines(lines: string[]): Generator<string> {
    for (const line of lines) {
      const trimmed = line.trim();
      // The SSE spec allows `data:` with or without a space after the colon.
      if (trimmed.startsWith('data:')) {
        const payload = trimmed.slice(5).trim();
        if (payload === '' || payload === '[DONE]') {
          continue;
        }
        yield payload;
      }
    }
  }

  try {
    while (true) {
      const { done, value } = await readStreamChunk(reader, idleTimeoutMs);
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      yield* parseLines(lines);
    }

    // Flush the decoder (a trailing multi-byte UTF-8 sequence may still be
    // pending) and the residual buffer. Without this the final event — usually
    // the usage or finish frame — is silently dropped when the stream does not
    // end with a newline.
    buffer += decoder.decode();
    yield* parseLines(buffer.split('\n'));
  } finally {
    try {
      await reader.cancel();
    } catch {}
    reader.releaseLock();
  }
}

/**
 * Reads a `ReadableStream<Uint8Array>` where each line is a standalone
 * JSON object (no `data:` prefix). Used by Ollama.
 *
 * Exported so the unterminated-final-line and split-character handling can be
 * tested directly.
 */
export async function* readJSONLines(
  body: ReadableStream<Uint8Array>,
  idleTimeoutMs = STREAM_IDLE_TIMEOUT_MS,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  // Shared by the read loop and the final flush (same pattern as readSSEStream).
  function* parseLines(lines: string[]): Generator<string> {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        continue;
      }
      yield trimmed;
    }
  }

  try {
    while (true) {
      const { done, value } = await readStreamChunk(reader, idleTimeoutMs);
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      yield* parseLines(lines);
    }

    // Flush the decoder and the residual buffer so a final JSON line that is
    // not newline-terminated (typically the `done` frame carrying usage) is
    // still parsed.
    buffer += decoder.decode();
    yield* parseLines(buffer.split('\n'));
  } finally {
    try {
      await reader.cancel();
    } catch {}
    reader.releaseLock();
  }
}

/**
 * Reads a `ReadableStream<Uint8Array>` for Anthropic's event-based SSE.
 * Each event consists of an `event: …` line followed by `data: …`.
 * Yields `{ event, data }` tuples.
 *
 * Exported so the unterminated-final-event and `event:`/`data:` spacing rules
 * can be tested directly.
 */
export async function* readAnthropicSSE(
  body: ReadableStream<Uint8Array>,
  idleTimeoutMs = STREAM_IDLE_TIMEOUT_MS,
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';

  // Shared by the read loop and the final flush (same pattern as readSSEStream).
  // `currentEvent` lives in the enclosing scope so an `event:` line read in one
  // chunk still applies to the `data:` line in the next.
  function* parseLines(lines: string[]): Generator<{ event: string; data: string }> {
    for (const line of lines) {
      const trimmed = line.trim();
      // The SSE spec allows `event:`/`data:` with or without a space.
      if (trimmed.startsWith('event:')) {
        currentEvent = trimmed.slice(6).trim();
      } else if (trimmed.startsWith('data:')) {
        const payload = trimmed.slice(5).trim();
        if (payload !== '') {
          yield { event: currentEvent, data: payload };
        }
        currentEvent = '';
      }
    }
  }

  try {
    while (true) {
      const { done, value } = await readStreamChunk(reader, idleTimeoutMs);
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      yield* parseLines(lines);
    }

    // Flush the decoder and the residual buffer: the final `message_delta`
    // (usage/stop reason) often arrives without a trailing newline.
    buffer += decoder.decode();
    yield* parseLines(buffer.split('\n'));
  } finally {
    try {
      await reader.cancel();
    } catch {}
    reader.releaseLock();
  }
}

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

// ─── SSRF protection helpers ──────────────────────────────

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_ERROR_BODY_BYTES = 64 * 1024; // 64 KB — error payloads only need the message
const DEFAULT_TIMEOUT_MS = 60_000; // 60s for non-streaming requests
const STREAM_TIMEOUT_MS = 120_000; // 120s timeout for streaming connection/headers
/** Max gap between body chunks once a stream is open (see readStreamChunk). */
const STREAM_IDLE_TIMEOUT_MS = 120_000;

/**
 * Sent on every outbound provider request. Upstream gateways fingerprint
 * generic SDK/HTTP-library user agents and expect a named client, so undici's
 * default is replaced with this app's own identifier.
 */
const CLIENT_USER_AGENT = 'sovereign/1.0';

/** OpenCode's Zen/Go gateway (see https://opencode.ai/docs/go). */
const OPENCODE_HOST_RE = /(^|\.)opencode\.ai$/i;

/**
 * `x-opencode-session` carries a stable id per conversation so the gateway can
 * optimize routing and prompt caching; it rejects chat requests without one.
 * Returns the hostname when `url` targets that gateway, null otherwise (or when
 * the URL is unparseable, which `ssrfFetch` reports properly further down).
 */
function opencodeHostname(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    return OPENCODE_HOST_RE.test(hostname) ? hostname : null;
  } catch {
    return null;
  }
}

/**
 * SSRF-safe fetch wrapper with URL validation, timeouts, and redirect capping.
 *
 * When `validateUrl` is true, performs DNS resolution and blocks requests
 * targeting private/loopback/link-local/ULA/multicast/metadata addresses.
 *
 * All responses are capped at 0 redirects (`redirect: 'error'`).
 * Timeout errors and SSRF rejections are converted to `ProviderError`.
 */
export async function ssrfFetch(
  providerName: AIProvider,
  url: string,
  init?: RequestInit,
  options?: { validateUrl?: boolean; timeout?: number; signal?: AbortSignal },
): Promise<Response> {
  // Full SSRF validation + IP pinning (F-11 TOCTOU): DNS is resolved in
  // validateOutboundUrl and bound private IPs are rejected. To avoid a DNS
  // rebinding TOCTOU between validation and fetch, the validated IP is pinned
  // at the *connection* layer via an undici dispatcher. This keeps the original
  // hostname in the URL so the TLS SNI (and thus virtual-host cert selection)
  // is preserved (regression N-2). Local/loopback hosts skip pinning entirely
  // (N-1) and use the normal resolver. Redirects are blocked (redirect: 'error').
  let fetchUrl = url;
  let dispatcher: unknown;
  if (options?.validateUrl) {
    try {
      const { url: parsed, addresses } = await validateOutboundUrl(url);
      fetchUrl = parsed.href;
      if (addresses.length > 0) {
        dispatcher = createPinnedIpDispatcher(parsed, addresses[0]!);
      }
    } catch (e) {
      if (e instanceof SsrfError) {
        throw new ProviderError(providerName, 0, e.reason, e.message);
      }
      throw e;
    }
  }

  const controller = new AbortController();
  const timeoutMs = options?.timeout ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Forward external cancellation (client disconnect, route abort) to the request.
  const onExternalAbort = () => controller.abort();
  options?.signal?.addEventListener('abort', onExternalAbort, { once: true });
  try {
    // validateOutboundUrl ensures the domain resolves strictly to public IPs.
    // We fetch the original URL (hostname intact for SNI) with redirect: 'error'
    // to block all redirects. When an IP was pinned, a custom dispatcher routes
    // the connection to that IP without altering the SNI.

    const mergedHeaders: Record<string, string> = {
      ...((init?.headers as Record<string, string> | undefined) ?? {}),
    };
    if (!Object.keys(mergedHeaders).some((name) => name.toLowerCase() === 'user-agent')) {
      mergedHeaders['User-Agent'] = CLIENT_USER_AGENT;
    }
    const response = await fetch(fetchUrl, {
      ...init,
      ...(Object.keys(mergedHeaders).length ? { headers: mergedHeaders } : {}),
      ...(dispatcher !== undefined ? { dispatcher } : {}),
      signal: controller.signal,
      redirect: 'error', // Zero redirects — block all redirects
    } as RequestInit & { dispatcher?: unknown });
    return response;
  } catch (e) {
    // Convert abort (timeout) into structured error
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ProviderError(providerName, 0, 'request_timeout', 'Request timed out');
    }
    throw e;
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * Creates a `TransformStream` that caps the number of bytes read.
 * Once the limit is exceeded, the stream errors to prevent memory exhaustion.
 */
function createBodySizeLimit(maxBytes: number): TransformStream<Uint8Array, Uint8Array> {
  let total = 0;
  return new TransformStream({
    transform(chunk, controller) {
      total += chunk.byteLength;
      if (total > maxBytes) {
        controller.error(new Error(`Response body exceeded ${maxBytes} bytes`));
      } else {
        controller.enqueue(chunk);
      }
    },
  });
}

/**
 * Limits applied while reading a response body.
 *
 * `ssrfFetch` clears its abort timer as soon as the headers arrive, so without
 * these a stalled endpoint can dribble a body forever (holding the caller's
 * generation lease) and a large one is buffered in full before any size check.
 */
export interface ReadResponseOptions {
  /** Byte cap for the body. Defaults to {@link MAX_BODY_BYTES}. */
  maxBytes?: number;
  /** Wall-clock budget for the whole body. Defaults to {@link DEFAULT_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Status reported on the size-limit error — non-streaming reads report 0. */
  tooLargeStatus?: number;
  /** Message reported on the size-limit error. */
  tooLargeMessage?: string;
}

/**
 * Reads a response body, aborting once it exceeds `maxBytes` or outlives
 * `timeoutMs`. This replaces `response.text()` / `response.arrayBuffer()` /
 * `response.json()` on non-streaming responses, which buffer an unbounded body
 * before any check and inherit no deadline from `ssrfFetch`.
 */
export async function readResponseBytes(
  providerName: AIProvider,
  response: Response,
  options?: ReadResponseOptions,
): Promise<Uint8Array> {
  const maxBytes = options?.maxBytes ?? MAX_BODY_BYTES;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const body = response.body;
  if (!body) return new Uint8Array(0);

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new ProviderError(providerName, 0, 'request_timeout', 'Response body timed out')),
      timeoutMs,
    );
  });

  try {
    for (;;) {
      const read = reader.read();
      // The deadline can win the race; mark the losing read as handled so the
      // cancellation below cannot surface as an unhandled rejection.
      read.catch(() => {});
      const { done, value } = await Promise.race([read, expired]);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new ProviderError(
          providerName,
          options?.tooLargeStatus ?? 0,
          'response_too_large',
          options?.tooLargeMessage ??
            `Response body exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit`,
        );
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    try {
      await reader.cancel();
      reader.releaseLock();
    } catch {
      // The reader is discarded either way — the body is never read again.
    }
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** UTF-8 text form of {@link readResponseBytes} — the safe `response.text()`. */
export async function readResponseText(
  providerName: AIProvider,
  response: Response,
  options?: ReadResponseOptions,
): Promise<string> {
  return new TextDecoder().decode(await readResponseBytes(providerName, response, options));
}

/**
 * Safe `response.json()`.
 *
 * `readResponseText` runs *outside* the parse guard deliberately: it is where
 * `request_timeout` and `response_too_large` originate, and callers key retry
 * behaviour off those codes. Letting them fall into the `invalid_json` branch
 * would relabel an infrastructure failure as a malformed payload — with
 * `response.status === 200`, since this runs only after the `!response.ok`
 * check — and silently make timeouts non-retryable.
 */
export async function readJsonResponse(
  providerName: AIProvider,
  response: Response,
  options?: ReadResponseOptions,
): Promise<unknown> {
  const text = await readResponseText(providerName, response, options);
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new ProviderError(
      providerName,
      response.status,
      'invalid_json',
      `Failed to parse response: ${e instanceof Error ? e.message : 'Unknown error'}`,
    );
  }
}

// ─── Provider Interface ───────────────────────────────────

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
    const response = await ssrfFetch(
      this.name,
      url,
      {
        method: 'POST',
        headers: this.authHeaders(apiKey, { url, sessionId: options?.sessionId }),
        body: JSON.stringify(this.buildPayload(model, messages, options, false)),
      },
      { validateUrl: hasCustomEndpoint, signal: options?.signal },
    );

    if (!response.ok) {
      throw await this.parseError(response);
    }

    const data = await readJsonResponse(this.name, response);
    return this.parseNonStreamingResponse(data);
  }

  // ── Streaming ──

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
    const response = await ssrfFetch(
      this.name,
      url,
      {
        method: 'POST',
        headers: this.authHeaders(apiKey, { url, sessionId: options?.sessionId }),
        body: JSON.stringify(this.buildPayload(model, messages, options, true)),
      },
      { validateUrl: hasCustomEndpoint, timeout: STREAM_TIMEOUT_MS, signal: options?.signal },
    );

    if (!response.ok) {
      throw await this.parseError(response);
    }

    const rawBody = response.body;
    if (!rawBody) {
      throw new Error('Response body is null — cannot stream');
    }

    // Cap streaming response body size to prevent resource exhaustion
    const body = rawBody.pipeThrough(createBodySizeLimit(MAX_BODY_BYTES));

    let accumulatedContent = '';
    let accumulatedReasoning = '';
    let accumulatedToolCalls: ToolCall[] = [];
    let finishReason: string = 'stop';
    let finalUsage: AICompletionResponse['usage'] = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    for await (const raw of readSSEStream(body)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!isObject(parsed)) continue;

      // usage in final chunk (OpenAI with stream_options.include_usage)
      const usageRaw = parsed['usage'];
      if (isObject(usageRaw)) {
        finalUsage = {
          promptTokens: safeNumber(usageRaw['prompt_tokens']),
          completionTokens: safeNumber(usageRaw['completion_tokens']),
          totalTokens: safeNumber(usageRaw['total_tokens']),
        };
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
    let message = `HTTP ${response.status}: ${response.statusText}`;
    let code = 'unknown';
    try {
      const body: unknown = JSON.parse(
        await readResponseText(this.name, response, { maxBytes: MAX_ERROR_BODY_BYTES }),
      );
      if (isObject(body)) {
        const error = body['error'];
        if (isObject(error)) {
          if (isString(error['message'])) message = error['message'];
          if (isString(error['code'])) code = error['code'];
          if (isString(error['type'])) code = error['type'];
        }
      }
    } catch {
      // ignore JSON parse errors, fall back to status text
    }
    return new ProviderError(this.name, response.status, code, message);
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
    const usage: AICompletionResponse['usage'] = isObject(rawUsage)
      ? {
          promptTokens: safeNumber(rawUsage['prompt_tokens']),
          completionTokens: safeNumber(rawUsage['completion_tokens']),
          totalTokens: safeNumber(rawUsage['total_tokens']),
        }
      : { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    return {
      content,
      finishReason: toolCalls.length > 0 && finishReason === 'stop' ? 'tool_calls' : finishReason,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage,
    };
  }

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

  async complete(
    model: string,
    messages: GatewayMessage[],
    apiKey: string,
    options?: ProviderCompleteOptions,
  ): Promise<AICompletionResponse> {
    const baseUrl = options?.baseUrl ?? 'https://api.anthropic.com/v1';
    const url = `${baseUrl}/messages`;
    const hasCustomEndpoint = options?.baseUrl !== undefined;
    const response = await ssrfFetch(
      this.name,
      url,
      {
        method: 'POST',
        headers: this.headers(apiKey),
        body: JSON.stringify(this.buildPayload(model, messages, options, false)),
      },
      { validateUrl: hasCustomEndpoint, signal: options?.signal },
    );

    if (!response.ok) {
      throw await this.parseError(response);
    }

    const data = await readJsonResponse(this.name, response);
    return this.parseNonStreamingResponse(data);
  }
  // ── Streaming ──

  async *stream(
    model: string,
    messages: GatewayMessage[],
    apiKey: string,
    options?: ProviderCompleteOptions,
  ): AsyncGenerator<AIStreamChunk, AICompletionResponse> {
    const baseUrl = options?.baseUrl ?? 'https://api.anthropic.com/v1';
    const url = `${baseUrl}/messages`;
    const hasCustomEndpoint = options?.baseUrl !== undefined;
    const response = await ssrfFetch(
      this.name,
      url,
      {
        method: 'POST',
        headers: this.headers(apiKey),
        body: JSON.stringify(this.buildPayload(model, messages, options, true)),
      },
      { validateUrl: hasCustomEndpoint, timeout: STREAM_TIMEOUT_MS, signal: options?.signal },
    );

    if (!response.ok) {
      throw await this.parseError(response);
    }

    const rawBody = response.body;
    if (!rawBody) {
      throw new Error('Response body is null — cannot stream');
    }

    // Cap streaming body size for SSRF/memory protection
    const body = rawBody.pipeThrough(createBodySizeLimit(MAX_BODY_BYTES));
    let accumulatedContent = '';
    let accumulatedReasoning = '';
    let finalUsage: AICompletionResponse['usage'] = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };
    let finishReason: AIStreamChunk['finishReason'];

    for await (const { event, data: raw } of readAnthropicSSE(body)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!isObject(parsed)) continue;

      switch (event) {
        case 'message_start': {
          const msg = parsed['message'];
          if (isObject(msg)) {
            const usageRaw = msg['usage'];
            if (isObject(usageRaw)) {
              finalUsage = {
                promptTokens: safeNumber(usageRaw['input_tokens']),
                completionTokens: safeNumber(usageRaw['output_tokens']),
                totalTokens:
                  safeNumber(usageRaw['input_tokens']) + safeNumber(usageRaw['output_tokens']),
              };
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
    let message = `HTTP ${response.status}: ${response.statusText}`;
    let code = 'unknown';
    try {
      const body: unknown = JSON.parse(
        await readResponseText(this.name, response, { maxBytes: MAX_ERROR_BODY_BYTES }),
      );
      if (isObject(body)) {
        const error = body['error'];
        if (isObject(error)) {
          if (isString(error['message'])) message = error['message'];
          if (isString(error['type'])) code = error['type'];
        }
      }
    } catch {
      // ignore
    }
    return new ProviderError(this.name, response.status, code, message);
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
    const usage: AICompletionResponse['usage'] = isObject(rawUsage)
      ? {
          promptTokens: safeNumber(rawUsage['input_tokens']),
          completionTokens: safeNumber(rawUsage['output_tokens']),
          totalTokens: safeNumber(rawUsage['input_tokens']) + safeNumber(rawUsage['output_tokens']),
        }
      : { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    return { content, finishReason: 'stop', usage };
  }

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

  async complete(
    model: string,
    messages: GatewayMessage[],
    apiKey: string,
    options?: ProviderCompleteOptions,
  ): Promise<AICompletionResponse> {
    const baseUrl = options?.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
    const url = `${baseUrl}/models/${model}:generateContent`;
    const hasCustomEndpoint = options?.baseUrl !== undefined;

    const response = await ssrfFetch(
      this.name,
      url,
      {
        method: 'POST',
        headers: this.headers(apiKey),
        body: JSON.stringify(this.buildPayload(messages, options)),
      },
      { validateUrl: hasCustomEndpoint, signal: options?.signal },
    );

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

    const response = await ssrfFetch(
      this.name,
      url,
      {
        method: 'POST',
        headers: this.headers(apiKey),
        body: JSON.stringify(this.buildPayload(messages, options)),
      },
      { validateUrl: hasCustomEndpoint, timeout: STREAM_TIMEOUT_MS, signal: options?.signal },
    );

    if (!response.ok) {
      throw await this.parseError(response);
    }

    const rawBody = response.body;
    if (!rawBody) {
      throw new Error('Response body is null — cannot stream');
    }

    // Cap streaming body size for SSRF/memory protection
    const body = rawBody.pipeThrough(createBodySizeLimit(MAX_BODY_BYTES));

    let accumulatedContent = '';
    let finishReason: AIStreamChunk['finishReason'] = 'stop';
    let finalUsage: AICompletionResponse['usage'] = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    for await (const raw of readSSEStream(body)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!isObject(parsed)) continue;

      // usage metadata
      const usageRaw = parsed['usageMetadata'];
      if (isObject(usageRaw)) {
        finalUsage = {
          promptTokens: safeNumber(usageRaw['promptTokenCount']),
          completionTokens: safeNumber(usageRaw['candidatesTokenCount']),
          totalTokens: safeNumber(usageRaw['totalTokenCount']),
        };
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
    let message = `HTTP ${response.status}: ${response.statusText}`;
    let code = 'unknown';
    try {
      const body: unknown = JSON.parse(
        await readResponseText(this.name, response, { maxBytes: MAX_ERROR_BODY_BYTES }),
      );
      if (isObject(body)) {
        const error = body['error'];
        if (isObject(error)) {
          if (isString(error['message'])) message = error['message'];
          if (isString(error['status'])) code = error['status'];
          if (typeof error['code'] === 'number') code = String(error['code']);
        }
      }
    } catch {
      // ignore
    }
    return new ProviderError(this.name, response.status, code, message);
  }

  private parseResponse(data: unknown): AICompletionResponse {
    if (!isObject(data)) throw new Error('Google response is not an object');

    const candidates = data['candidates'];
    if (!Array.isArray(candidates) || candidates.length === 0) {
      // blocked / empty response — return empty content
      const usageRaw = data['usageMetadata'];
      const usage: AICompletionResponse['usage'] = isObject(usageRaw)
        ? {
            promptTokens: safeNumber(usageRaw['promptTokenCount']),
            completionTokens: safeNumber(usageRaw['candidatesTokenCount']),
            totalTokens: safeNumber(usageRaw['totalTokenCount']),
          }
        : { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
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
    const usage: AICompletionResponse['usage'] = isObject(rawUsage)
      ? {
          promptTokens: safeNumber(rawUsage['promptTokenCount']),
          completionTokens: safeNumber(rawUsage['candidatesTokenCount']),
          totalTokens: safeNumber(rawUsage['totalTokenCount']),
        }
      : { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    return { content, finishReason: 'stop', usage };
  }

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

    const response = await ssrfFetch(
      this.name,
      `${baseUrl}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.buildPayload(model, messages, options, false)),
      },
      { validateUrl: true, signal: options?.signal },
    );

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

    const response = await ssrfFetch(
      this.name,
      `${baseUrl}/api/chat`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.buildPayload(model, messages, options, true)),
      },
      { validateUrl: true, timeout: STREAM_TIMEOUT_MS, signal: options?.signal },
    );

    if (!response.ok) {
      throw await this.parseError(response);
    }

    const rawBody = response.body;
    if (!rawBody) {
      throw new Error('Response body is null — cannot stream');
    }
    const body = rawBody.pipeThrough(createBodySizeLimit(MAX_BODY_BYTES));

    let accumulatedContent = '';
    let finishReason: AIStreamChunk['finishReason'] = 'stop';
    let finalUsage: AICompletionResponse['usage'] = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    };

    for await (const raw of readJSONLines(body)) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!isObject(parsed)) continue;

      const msg = parsed['message'];
      if (isObject(msg)) {
        const text = safeString(msg['content']);
        if (text !== '') {
          accumulatedContent += text;
          yield { content: text };
        }
      }

      if (parsed['done'] === true) {
        finalUsage = {
          promptTokens: safeNumber(parsed['prompt_eval_count']),
          completionTokens: safeNumber(parsed['eval_count']),
          totalTokens: safeNumber(parsed['prompt_eval_count']) + safeNumber(parsed['eval_count']),
        };
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
    let message = `HTTP ${response.status}: ${response.statusText}`;
    let code = 'unknown';
    try {
      const body: unknown = JSON.parse(
        await readResponseText(this.name, response, { maxBytes: MAX_ERROR_BODY_BYTES }),
      );
      if (isObject(body)) {
        if (isString(body['error'])) {
          message = body['error'];
        }
      }
    } catch {
      // ignore
    }
    return new ProviderError(this.name, response.status, code, message);
  }

  private parseResponse(data: unknown): AICompletionResponse {
    if (!isObject(data)) throw new Error('Ollama response is not an object');

    const msg = data['message'];
    const content = isObject(msg) ? safeString(msg['content']) : '';

    const usage: AICompletionResponse['usage'] = {
      promptTokens: safeNumber(data['prompt_eval_count']),
      completionTokens: safeNumber(data['eval_count']),
      totalTokens: safeNumber(data['prompt_eval_count']) + safeNumber(data['eval_count']),
    };

    return { content, finishReason: 'stop', usage };
  }

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
