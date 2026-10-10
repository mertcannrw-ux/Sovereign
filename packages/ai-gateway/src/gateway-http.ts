/**
 * Shared HTTP + wire-format layer for the AI gateway.
 *
 * Everything here is common to at least two providers: the SSRF-safe fetch
 * wrapper, response-body limits, stream framing readers and the
 * `!response.ok` error-body parser. Provider OUTPUT dialects (usage key
 * names, delta shapes, error-body JSON shapes) are passed in as hook
 * functions by the provider classes in `provider.ts`, which keep owning
 * their dialect.
 */
import type { AIProvider, AICompletionResponse } from '@app-builder/shared';
import { ProviderError } from './types';
import { SsrfError, validateOutboundUrl } from './ssrf';
import type { Dispatcher } from 'undici';
import { isObject, safeNumber } from './guards';

// ─── Usage dialects ───────────────────────────────────────

/**
 * Token-usage numbers in the gateway's normalized shape.
 */
export interface UsageCounts {
  prompt: number;
  completion: number;
  total: number;
}

/** Anthropic reports `input_tokens` / `output_tokens`; there is no total key. */
export function readAnthropicUsage(raw: Record<string, unknown>): UsageCounts {
  return usageFromNumbers(
    safeNumber(raw['input_tokens']),
    safeNumber(raw['output_tokens']),
    safeNumber(raw['input_tokens']) + safeNumber(raw['output_tokens']),
  );
}

/** Gemini reports `promptTokenCount` / `candidatesTokenCount` / `totalTokenCount`. */
export function readGeminiUsage(raw: Record<string, unknown>): UsageCounts {
  return usageFromNumbers(
    safeNumber(raw['promptTokenCount']),
    safeNumber(raw['candidatesTokenCount']),
    safeNumber(raw['totalTokenCount']),
  );
}

/** OpenAI reports `prompt_tokens` / `completion_tokens` / `total_tokens`. */
export function readOpenAIUsage(raw: Record<string, unknown>): UsageCounts {
  return usageFromNumbers(
    safeNumber(raw['prompt_tokens']),
    safeNumber(raw['completion_tokens']),
    safeNumber(raw['total_tokens']),
  );
}

/**
 * Ollama reports `prompt_eval_count` / `eval_count`; there is no total key.
 * The same keys arrive both top-level (non-streaming) and inside the
 * `done: true` frame (streaming), so both call sites share this reader.
 */
export function readOllamaUsage(raw: Record<string, unknown>): UsageCounts {
  return usageFromNumbers(
    safeNumber(raw['prompt_eval_count']),
    safeNumber(raw['eval_count']),
    safeNumber(raw['prompt_eval_count']) + safeNumber(raw['eval_count']),
  );
}

/** Zeroed usage — the shape every provider defaults to before a frame arrives. */
export function emptyUsage(): AICompletionResponse['usage'] {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

function usageFromNumbers(prompt: number, completion: number, total: number): UsageCounts {
  return { prompt, completion, total };
}

/** Builds the normalized usage object from dialect-read counts. */
export function toUsage(counts: UsageCounts): AICompletionResponse['usage'] {
  return {
    promptTokens: counts.prompt,
    completionTokens: counts.completion,
    totalTokens: counts.total,
  };
}

/**
 * Unwraps a raw usage object through a dialect reader; anything other than an
 * object (absent usage, wrong type) becomes the zeroed usage.
 */
export function parseUsage(
  raw: unknown,
  read: (raw: Record<string, unknown>) => UsageCounts,
): AICompletionResponse['usage'] {
  return toUsage(isObject(raw) ? read(raw) : { prompt: 0, completion: 0, total: 0 });
}

// ─── Stream readers ───────────────────────────────────────
// Three wire formats, one loop: OpenAI-compatible `data:` SSE, Anthropic
// `event:`/`data:` SSE, and Ollama bare JSON lines. [[readDelimitedLines]]
// owns the framing rules; the exported generators own their per-format
// line rules and stay exported so they can be tested directly.

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
 * Core line reader behind `readSSEStream` / `readJSONLines` /
 * `readAnthropicSSE`. Yields each newline-terminated line decoded as UTF-8 —
 * plus the final unterminated one — passed through `step`, which applies the
 * format's line rule and returns at most one value per line (or `undefined`
 * when the line carries no payload).
 *
 * Shared by the read loop and the final flush. The last event of a stream is
 * frequently not newline-terminated; the residual-buffer flush below exists
 * so the final frame — usually the usage or finish frame — is not silently
 * dropped when the stream does not end with a newline.
 */
async function* readDelimitedLines<T>(
  body: ReadableStream<Uint8Array>,
  idleTimeoutMs: number,
  step: (line: string) => T | undefined,
): AsyncGenerator<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await readStreamChunk(reader, idleTimeoutMs);
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const out = step(line);
        if (out !== undefined) yield out;
      }
    }

    // Flush the decoder (a trailing multi-byte UTF-8 sequence may still be
    // pending) and the residual buffer.
    buffer += decoder.decode();
    for (const line of buffer.split('\n')) {
      const out = step(line);
      if (out !== undefined) yield out;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {}
    reader.releaseLock();
  }
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
  return yield* readDelimitedLines(body, idleTimeoutMs, (line) => {
    const trimmed = line.trim();
    // The SSE spec allows `data:` with or without a space after the colon.
    if (!trimmed.startsWith('data:')) return undefined;
    const payload = trimmed.slice(5).trim();
    if (payload === '' || payload === '[DONE]') {
      return undefined;
    }
    return payload;
  });
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
  return yield* readDelimitedLines(body, idleTimeoutMs, (line) => {
    const trimmed = line.trim();
    if (trimmed === '') {
      return undefined;
    }
    return trimmed;
  });
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
  // `currentEvent` lives outside the loop so an `event:` line read in one
  // chunk still applies to the `data:` line in the next.
  let currentEvent = '';
  return yield* readDelimitedLines(body, idleTimeoutMs, (line) => {
    const trimmed = line.trim();
    // The SSE spec allows `event:`/`data:` with or without a space.
    if (trimmed.startsWith('event:')) {
      currentEvent = trimmed.slice(6).trim();
      return undefined;
    }
    if (trimmed.startsWith('data:')) {
      const payload = trimmed.slice(5).trim();
      const event = currentEvent;
      // Cleared for every `data:` line — empty keep-alives included — so a
      // data line without its own `event:` never inherits a stale name.
      currentEvent = '';
      if (payload !== '') {
        return { event, data: payload };
      }
    }
    return undefined;
  });
}

// ─── SSRF-safe fetch ──────────────────────────────────────

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
export function opencodeHostname(url: string): string | null {
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

  // The caller's signal must stay wired for the WHOLE request, including the
  // response body — which is still in flight when `fetch()` resolves. A
  // hand-rolled listener removed in the `finally` below detached it at header
  // time, so a client disconnect (Stop) after the first byte left the provider
  // call running, and billing, to completion.
  //
  // The link is not free. Node pins an `AbortSignal.any` composite in a
  // process-global strong set until it aborts, loses its last abort listener,
  // or its sources are collected — and undici never removes its abort listener
  // on a normally-completing request. So each call keeps its request graph
  // reachable from `options.signal`, which one agent run reuses for every
  // provider call, for the life of that run. Measured: dropping the run signal
  // released 99.9% of it once the event loop turned (FinalizationRegistry
  // callbacks are not synchronous with gc()), so this is run-bounded retention,
  // not a process-lifetime leak. Releasing at body-settle time instead would
  // cost a per-request stream wrapper on the streaming hot path to save a few
  // KB per call.
  const signal = options?.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
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
      signal,
      redirect: 'error', // Zero redirects — block all redirects
    } as RequestInit & { dispatcher?: unknown });
    return response;
  } catch (e) {
    // Convert abort (timeout) into structured error
    if (e instanceof DOMException && e.name === 'AbortError') {
      // Keep a deliberate cancellation apart from a deadline: callers retry
      // `request_timeout`, and a request the user stopped must not be retried.
      const cancelled = options?.signal?.aborted === true;
      throw new ProviderError(
        providerName,
        0,
        cancelled ? 'cancelled' : 'request_timeout',
        cancelled ? 'Request cancelled' : 'Request timed out',
      );
    }
    throw e;
  } finally {
    // The deadline bounds time-to-headers only. Streaming bodies are governed
    // by the per-chunk idle timeout in the readers above; letting a 60s wall
    // clock cover the body as well would kill legitimate long generations.
    clearTimeout(timeout);
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
 * A streaming response body under the global size cap.
 *
 * Caps the stream at {@link MAX_BODY_BYTES} (10 MB) via `createBodySizeLimit`
 * so a malicious or runaway endpoint cannot stream a body forever and balloon
 * memory — the size cap is applied inside the read pipeline, not per chunk.
 */
export function streamingBody(response: Response): ReadableStream<Uint8Array> {
  const rawBody = response.body;
  if (!rawBody) {
    throw new Error('Response body is null — cannot stream');
  }
  return rawBody.pipeThrough(createBodySizeLimit(MAX_BODY_BYTES));
}

/**
 * The POST-JSON request shape shared by every completion and streaming call:
 * resolve the endpoint, `ssrfFetch` it (validating only caller-supplied
 * endpoints, {@link STREAM_TIMEOUT_MS} header deadline only when streaming),
 * and hand back the untouched `Response` — each provider applies its own
 * error-body dialect and response parser afterwards.
 */
export interface CompletionRequestOptions {
  /** Request headers — auth/session policy is the provider's. */
  headers: Record<string, string>;
  /** Request body, JSON-serialized exactly once here. */
  payload: unknown;
  /** Validates the URL only when the caller supplied the endpoint. */
  validateUrl: boolean;
  /** Adds the 120s streaming connection/headers deadline when true. */
  stream: boolean;
  signal?: AbortSignal;
}

/** Serializes and POSTs a completion payload, returning the raw response. */
export async function requestCompletion(
  providerName: AIProvider,
  url: string,
  options: CompletionRequestOptions,
): Promise<Response> {
  return await ssrfFetch(
    providerName,
    url,
    {
      method: 'POST',
      headers: options.headers,
      body: JSON.stringify(options.payload),
    },
    options.stream
      ? { validateUrl: options.validateUrl, timeout: STREAM_TIMEOUT_MS, signal: options.signal }
      : { validateUrl: options.validateUrl, signal: options.signal },
  );
}

/**
 * One streamed JSON frame, or `null` for anything an SSE/NDJSON stream may
 * legally interleave (blank keep-alives, garbage lines): skipping malformed
 * frames instead of aborting keeps a single bad line from killing the run.
 */
export function parseStreamFrame(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isObject(parsed) ? parsed : null;
}

// ─── Response body limits ─────────────────────────────────

/**
 * Limits applied while reading a response body.
 *
 * `ssrfFetch` clears its abort timer as soon as the headers arrive, so without
 * these a stalled endpoint can dribble a body forever (holding the caller's
 * generation lease) and a large one is buffered in full before any size check.
 */
export interface ReadResponseOptions {
  /** Byte cap for the body. Defaults to 10 MB. */
  maxBytes?: number;
  /** Wall-clock budget for the whole body. Defaults to 60s. */
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

// ─── Error-body parsing ───────────────────────────────────

/** The `code`/`message` override a provider dialect extracted from an error body. */
export interface PickedApiError {
  code?: string;
  message?: string;
}

/** Extracts a provider's dialect-specific error fields from a parsed error body. */
export type ApiErrorPicker = (body: Record<string, unknown>) => PickedApiError | undefined;

/**
 * Shared `!response.ok` handling: reads the error body capped at 64 KB, lets
 * the provider dialect pick `code`/`message` out of the parsed JSON
 * ({@link ApiErrorPicker} — OpenAI-compatible envelopes, Anthropic `type`,
 * Gemini `status`, Ollama string bodies), and falls back to
 * ``HTTP <status>: <statusText>`` + `code: 'unknown'` whenever the body is
 * unparseable or the dialect finds nothing.
 */
export async function parseUpstreamError(
  providerName: AIProvider,
  response: Response,
  pick: ApiErrorPicker,
): Promise<ProviderError> {
  let message = `HTTP ${response.status}: ${response.statusText}`;
  let code = 'unknown';
  try {
    const body: unknown = JSON.parse(
      await readResponseText(providerName, response, { maxBytes: MAX_ERROR_BODY_BYTES }),
    );
    if (isObject(body)) {
      const picked = pick(body);
      if (picked !== undefined) {
        if (picked.message !== undefined) message = picked.message;
        if (picked.code !== undefined) code = picked.code;
      }
    }
  } catch {
    // ignore JSON parse errors, fall back to status text
  }
  return new ProviderError(providerName, response.status, code, message);
}
