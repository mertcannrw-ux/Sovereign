import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getProvider, readResponseBytes, readResponseText } from './provider';
import type { GatewayMessage } from './tool-calls';

// DNS is resolved by the SSRF layer; stub it so these tests never touch the
// network and always exercise the "public address" path.
vi.mock('./ssrf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ssrf')>();
  return {
    ...actual,
    validateOutboundUrl: vi.fn(async (url: string) => ({
      url: new URL(url),
      addresses: ['93.184.216.34'],
    })),
  };
});

/**
 * `then` describes what the body does once `chunks` are exhausted: `close` ends
 * the response, `yield` keeps sending bytes (a body that outgrows any cap), and
 * `stall` sends nothing more without ever closing (a socket the peer keeps open).
 */
function streamedResponse(chunks: Uint8Array[], then: 'close' | 'yield' | 'stall'): Response {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index]!);
        index += 1;
        return;
      }
      if (then === 'close') controller.close();
      else if (then === 'yield') controller.enqueue(new Uint8Array(4));
    },
  });
  return new Response(body);
}

describe('readResponseBytes', () => {
  it('stops at the byte cap instead of buffering a body that keeps yielding', async () => {
    const response = streamedResponse([], 'yield');

    await expect(
      readResponseBytes('openai', response, {
        maxBytes: 16,
        tooLargeStatus: 413,
        tooLargeMessage: 'Image response payload exceeded size limit',
      }),
    ).rejects.toMatchObject({
      code: 'response_too_large',
      status: 413,
      message: 'Image response payload exceeded size limit',
    });
  });

  it('rejects a stalled body on its deadline instead of waiting for the socket', async () => {
    const response = streamedResponse([], 'stall');

    await expect(readResponseBytes('openai', response, { timeoutMs: 50 })).rejects.toMatchObject({
      code: 'request_timeout',
    });
  });

  it('decodes multi-byte characters split across chunks', async () => {
    const encoded = new TextEncoder().encode('héllo — wörld');
    const response = streamedResponse([encoded.slice(0, 3), encoded.slice(3)], 'close');

    await expect(readResponseText('openai', response)).resolves.toBe('héllo — wörld');
  });
});

describe('outbound provider headers', () => {
  const originalFetch = globalThis.fetch;
  const prompt: GatewayMessage[] = [{ role: 'user', content: 'hey' }];
  let requests: { url: string; headers: Record<string, string> }[];
  let respond: () => Response;

  beforeEach(() => {
    requests = [];
    respond = () => new Response('{}');
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        url: String(input),
        headers: (init?.headers as Record<string, string> | undefined) ?? {},
      });
      return respond();
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends the session id and a named user agent to the OpenCode gateway', async () => {
    respond = () =>
      new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      });

    const stream = getProvider('custom').stream('longcat-2.0', prompt, 'k', {
      baseUrl: 'https://opencode.ai/zen/go/v1',
      sessionId: 'session-abc',
    });
    let content = '';
    for await (const chunk of stream) content += chunk.content;

    expect(content).toBe('hi');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://opencode.ai/zen/go/v1/chat/completions');
    expect(requests[0]!.headers['x-opencode-session']).toBe('session-abc');
    expect(requests[0]!.headers['User-Agent']).toBe('sovereign/1.0');
  });

  it('keeps the OpenCode session header out of other endpoints', async () => {
    respond = () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );

    const result = await getProvider('custom').complete('m', prompt, 'k', {
      baseUrl: 'https://api.example.com/v1',
      sessionId: 'session-abc',
    });

    expect(result.content).toBe('ok');
    expect(requests[0]!.headers['x-opencode-session']).toBeUndefined();
    expect(requests[0]!.headers['User-Agent']).toBe('sovereign/1.0');
  });

  it('omits the session header when the caller has no session for the conversation', async () => {
    respond = () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );

    await getProvider('custom').complete('m', prompt, 'k', {
      baseUrl: 'https://opencode.ai/zen/go/v1',
    });

    expect(requests[0]!.headers['x-opencode-session']).toBeUndefined();
  });
});
