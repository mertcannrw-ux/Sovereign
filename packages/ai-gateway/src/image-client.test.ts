import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateImage, normalizeImageEndpoint } from './image-client';
import { ProviderError } from './types';

// DNS is resolved by the SSRF layer; stub it so unit tests never depend on the
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

describe('normalizeImageEndpoint', () => {
  it('normalizes standard v1 base URLs', () => {
    expect(normalizeImageEndpoint('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/images/generations',
    );
    expect(normalizeImageEndpoint('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1/images/generations',
    );
  });

  it('normalizes URLs ending in /images/generations', () => {
    expect(normalizeImageEndpoint('https://api.openai.com/v1/images/generations')).toBe(
      'https://api.openai.com/v1/images/generations',
    );
    expect(normalizeImageEndpoint('https://api.openai.com/v1/images/generations/')).toBe(
      'https://api.openai.com/v1/images/generations',
    );
  });

  it('defaults to official OpenAI endpoint when empty or undefined', () => {
    expect(normalizeImageEndpoint()).toBe('https://api.openai.com/v1/images/generations');
    expect(normalizeImageEndpoint('')).toBe('https://api.openai.com/v1/images/generations');
  });
});

describe('generateImage', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('generates an image successfully from b64_json', async () => {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              b64_json: pngBase64,
              revised_prompt: 'A sleek modern dashboard',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    globalThis.fetch = mockFetch;

    const result = await generateImage('dall-e-3', 'Draw a dashboard', 'test-key');
    expect(result.mediaType).toBe('image/png');
    expect(result.revisedPrompt).toBe('A sleek modern dashboard');
    expect(result.bytes.length).toBeGreaterThan(0);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    // The URL keeps its original hostname so TLS SNI and vhost routing stay
    // correct; the validated IP is pinned at the connection layer instead of
    // rewriting the host (see createPinnedIpDispatcher).
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect(headers['Host']).toBeUndefined();
    expect(headers['Authorization']).toBe('Bearer test-key');
    expect((init as { dispatcher?: unknown } | undefined)?.dispatcher).toBeDefined();
  });

  it('handles upstream error response gracefully', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: 'Invalid API Key',
            code: 'invalid_api_key',
          },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(generateImage('dall-e-3', 'Draw a dashboard', 'bad-key')).rejects.toThrow(
      ProviderError,
    );
  });
});
