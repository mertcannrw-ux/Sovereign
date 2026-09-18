import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getProvider,
  readAnthropicSSE,
  readJSONLines,
  readResponseBytes,
  readResponseText,
  readSSEStream,
} from './provider';
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

/**
 * Feeds `chunks` verbatim and then ends the stream — deliberately never
 * appending a newline, since streams in the wild end on the final event.
 */
function byteStream(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const encoded = chunks.map((chunk) =>
    typeof chunk === 'string' ? encoder.encode(chunk) : chunk,
  );
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < encoded.length) {
        controller.enqueue(encoded[index]!);
        index += 1;
        return;
      }
      controller.close();
    },
  });
}

async function collect<T>(source: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}

// Regression: the readers used to drop the residual buffer on `done`, losing
// the final event (typically the usage/finish frame) whenever the stream did
// not end with a newline.
describe('stream readers', () => {
  describe('readSSEStream', () => {
    it('yields a final event that has no trailing newline', async () => {
      const events = await collect(readSSEStream(byteStream(['data: {"a":1}\n\ndata: {"b":2}'])));

      expect(events).toEqual(['{"a":1}', '{"b":2}']);
    });

    it('splits one event across chunks and still yields the unterminated tail', async () => {
      const events = await collect(readSSEStream(byteStream(['data: {"a"', ':1}\ndata: {"b":2}'])));

      expect(events).toEqual(['{"a":1}', '{"b":2}']);
    });

    it('flushes a multi-byte character split across the final chunk', async () => {
      const bytes = new TextEncoder().encode('data: {"t":"é"}');
      // Split inside the two-byte `é`: the decoder must carry the lead byte
      // across chunks and the residual buffer holds the unterminated event.
      const split = bytes.length - 3;

      const events = await collect(
        readSSEStream(byteStream([bytes.slice(0, split), bytes.slice(split)])),
      );

      expect(events).toEqual(['{"t":"é"}']);
    });

    it('accepts `data:` without a space after the colon', async () => {
      const events = await collect(readSSEStream(byteStream(['data:{"a":1}\ndata: [DONE]\n'])));

      expect(events).toEqual(['{"a":1}']);
    });
  });

  describe('readJSONLines', () => {
    it('yields a final line that has no trailing newline', async () => {
      const lines = await collect(readJSONLines(byteStream(['{"a":1}\n{"b":2}'])));

      expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    });

    it('splits one line across chunks and still yields the unterminated tail', async () => {
      const lines = await collect(readJSONLines(byteStream(['{"a":1}\n{"b"', ':2}'])));

      expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    });
  });

  describe('readAnthropicSSE', () => {
    it('yields a final event that has no trailing newline', async () => {
      const events = await collect(
        readAnthropicSSE(
          byteStream([
            'event: content_block_delta\ndata: {"i":1}\n\nevent: message_delta\ndata: {"s":2}',
          ]),
        ),
      );

      expect(events).toEqual([
        { event: 'content_block_delta', data: '{"i":1}' },
        { event: 'message_delta', data: '{"s":2}' },
      ]);
    });

    it('splits one event across chunks and still yields the unterminated tail', async () => {
      const events = await collect(
        readAnthropicSSE(
          byteStream([
            'event: content_block_delta\ndata: {"i"',
            ':1}\nevent: message_delta\ndata: {"s":2}',
          ]),
        ),
      );

      expect(events).toEqual([
        { event: 'content_block_delta', data: '{"i":1}' },
        { event: 'message_delta', data: '{"s":2}' },
      ]);
    });

    it('accepts `event:` and `data:` without a space after the colon', async () => {
      const events = await collect(
        readAnthropicSSE(byteStream(['event:message_delta\ndata:{"s":2}'])),
      );

      expect(events).toEqual([{ event: 'message_delta', data: '{"s":2}' }]);
    });
  });
});
