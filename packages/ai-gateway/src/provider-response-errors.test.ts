import { promises as dns } from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OllamaProvider, OpenAIProvider, readJsonResponse } from './provider';
import { ProviderError } from './types';

/**
 * Regression cover for two defects introduced when JSON parsing was wrapped in
 * try/catch and `validateUrl` was widened to every provider call.
 *
 * 1. The try/catch spanned `await readResponseText(...)`, so the
 *    `request_timeout` and `response_too_large` ProviderErrors thrown by
 *    `readResponseBytes` were caught and re-thrown as `invalid_json` carrying
 *    `status === 200`. Callers retry on `code === 'request_timeout'` or
 *    `status >= 500`, so infrastructure failures silently became terminal.
 * 2. `validateUrl: true` on hardcoded default hosts routed 100% of traffic
 *    through `validateOutboundUrl` → a per-request `dns.lookup` plus a
 *    per-request undici `Agent` (never destroyed, own socket pool) for a URL
 *    that is not attacker-controlled.
 */

const encoder = new TextEncoder();

/** Build a closed byte stream from text chunks for response reader tests. */
function bodyOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    /** Encode and enqueue each fixture chunk, then close the response body. */
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** A body that never produces a chunk — the deadline in `readResponseBytes` is
 *  what has to win, so the test drives the clock instead of sleeping. */
function stalledBody(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    /** Leave reads pending so the response reader must enforce its timeout. */
    pull() {
      // Intentionally never enqueues or closes.
    },
  });
}

/** Serialize a minimal successful OpenAI chat response with token usage. */
function openAiOkBody(): string {
  return JSON.stringify({
    choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('readJsonResponse error fidelity', () => {
  it('keeps response_too_large rather than relabelling it invalid_json', async () => {
    const response = new Response(bodyOf(Array.from({ length: 8 }, () => 'x'.repeat(200))), {
      status: 200,
    });

    const error = await readJsonResponse('openai', response, { maxBytes: 64 }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe('response_too_large');
  });

  it('keeps request_timeout rather than relabelling it invalid_json', async () => {
    vi.useFakeTimers();
    const response = new Response(stalledBody(), { status: 200 });

    const pending = readJsonResponse('openai', response, { timeoutMs: 50 }).catch(
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(60);
    const error = await pending;

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe('request_timeout');
  });

  it('still maps genuinely malformed JSON to invalid_json', async () => {
    const response = new Response('<html>gateway timeout</html>', { status: 200 });

    const error = await readJsonResponse('openai', response).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).code).toBe('invalid_json');
    expect((error as ProviderError).status).toBe(200);
  });

  it('parses a valid JSON body', async () => {
    const response = new Response(JSON.stringify({ ok: true, n: 42 }), { status: 200 });
    await expect(readJsonResponse('openai', response)).resolves.toEqual({ ok: true, n: 42 });
  });
});

describe('SSRF validation is scoped to caller-supplied endpoints', () => {
  it('resolves no DNS and attaches no pinned-IP dispatcher for a default host', async () => {
    const lookup = vi.spyOn(dns, 'lookup');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(openAiOkBody(), { status: 200 }));

    await new OpenAIProvider().complete('gpt-4o-mini', [{ role: 'user', content: 'x' }], 'key');

    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('api.openai.com');
    const init = fetchSpy.mock.calls[0]?.[1] as { dispatcher?: unknown } | undefined;
    expect(init?.dispatcher).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('still validates a caller-supplied base URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(
      new OpenAIProvider().complete('gpt-4o-mini', [{ role: 'user', content: 'x' }], 'key', {
        baseUrl: 'https://169.254.169.254/v1',
      }),
    ).rejects.toMatchObject({ code: 'private_ip' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps the Ollama loopback default behind ALLOW_LOOPBACK_PROVIDERS', async () => {
    process.env.ALLOW_LOOPBACK_PROVIDERS = 'false';
    try {
      const error = await new OllamaProvider()
        .complete('llama3', [{ role: 'user', content: 'x' }], '')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ProviderError);
      // chat.ts keys on this exact code to replace the misleading
      // "check your API key" line with the real, actionable reason.
      expect((error as ProviderError).code).toBe('loopback_blocked');
      expect((error as ProviderError).message).toContain('ALLOW_LOOPBACK_PROVIDERS');
    } finally {
      delete process.env.ALLOW_LOOPBACK_PROVIDERS;
    }
  });
});
