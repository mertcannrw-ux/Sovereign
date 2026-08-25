import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateImage, normalizeImageEndpoint } from './image-client';
import { ProviderError } from './types';

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
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
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
    // SSRF pinning rewrites the hostname to the validated IP, and the original
    // host is preserved via the Host header so TLS SNI / vhost routing works.
    const pinnedUrl = new URL(url);
    expect(pinnedUrl.pathname).toBe('/v1/images/generations');
    expect(headers['Host']).toBe('api.openai.com');
    expect(headers['Authorization']).toBe('Bearer test-key');
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
