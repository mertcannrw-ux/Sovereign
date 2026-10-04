import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Gateway } from './gateway';
import { ProviderError } from './types';
import type { Provider } from './provider';
import type { AICompletionRequest, AICompletionResponse, AIStreamChunk } from '@app-builder/shared';

// Mock the provider module
vi.mock('./provider', () => ({
  getProvider: vi.fn(),
}));

import { getProvider } from './provider';

// The Gateway only ever calls one method per path, so tests stub a single
// member of `Provider`; the unchecked cast is confined to these mocks.

const COMPLETION: AICompletionResponse = {
  content: 'Hello!',
  finishReason: 'stop',
  usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
};

describe('Gateway', () => {
  let gateway: Gateway;

  beforeEach(() => {
    gateway = new Gateway();
    vi.clearAllMocks();
  });

  describe('complete', () => {
    it('routes request to correct provider', async () => {
      const mockComplete = vi.fn().mockResolvedValue(COMPLETION);
      vi.mocked(getProvider).mockReturnValue({ complete: mockComplete } as unknown as Provider);

      const request: AICompletionRequest = {
        provider: 'openai',
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        apiKey: 'sk-test123',
      };

      const result = await gateway.complete(request, 'sk-test123');

      expect(getProvider).toHaveBeenCalledWith('openai');
      expect(mockComplete).toHaveBeenCalledWith(
        'gpt-4',
        [{ role: 'user', content: 'Hello' }],
        'sk-test123',
        expect.objectContaining({
          maxTokens: undefined,
          temperature: undefined,
        }),
      );
      expect(result.content).toBe('Hello!');
    });

    it('passes baseUrl to provider', async () => {
      const mockComplete = vi.fn().mockResolvedValue(COMPLETION);
      vi.mocked(getProvider).mockReturnValue({ complete: mockComplete } as unknown as Provider);

      const request: AICompletionRequest = {
        provider: 'ollama',
        model: 'llama2',
        messages: [{ role: 'user', content: 'Hello' }],
        apiKey: '',
      };

      await gateway.complete(request, '', 'http://localhost:11434');

      expect(mockComplete).toHaveBeenCalledWith(
        'llama2',
        [{ role: 'user', content: 'Hello' }],
        '',
        expect.objectContaining({
          baseUrl: 'http://localhost:11434',
        }),
      );
    });

    it('throws ProviderError on provider failure', async () => {
      const mockComplete = vi
        .fn()
        .mockRejectedValue(new ProviderError('openai', 401, 'invalid_api_key', 'Invalid API key'));
      vi.mocked(getProvider).mockReturnValue({ complete: mockComplete } as unknown as Provider);

      const request: AICompletionRequest = {
        provider: 'openai',
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        apiKey: 'sk-invalid',
      };

      await expect(gateway.complete(request, 'sk-invalid')).rejects.toThrow(ProviderError);
    });
  });

  describe('stream', () => {
    it('routes streaming request to correct provider', async () => {
      const mockStream = vi
        .fn<Provider['stream']>()
        .mockImplementation(async function* (): AsyncGenerator<
          AIStreamChunk,
          AICompletionResponse
        > {
          yield { content: 'Hello' };
          yield { content: ' world' };
          return COMPLETION;
        });
      vi.mocked(getProvider).mockReturnValue({ stream: mockStream } as unknown as Provider);

      const request: AICompletionRequest = {
        provider: 'openai',
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        apiKey: 'sk-test123',
      };

      const chunks: string[] = [];

      for await (const chunk of gateway.stream(request, 'sk-test123')) {
        if (chunk.content) {
          chunks.push(chunk.content);
        }
      }

      expect(getProvider).toHaveBeenCalledWith('openai');
      expect(chunks).toEqual(['Hello', ' world']);
    });

    it('passes baseUrl to provider for streaming', async () => {
      const mockStream = vi
        .fn<Provider['stream']>()
        .mockImplementation(async function* (): AsyncGenerator<
          AIStreamChunk,
          AICompletionResponse
        > {
          yield { content: 'Hello' };
          return COMPLETION;
        });
      vi.mocked(getProvider).mockReturnValue({ stream: mockStream } as unknown as Provider);

      const request: AICompletionRequest = {
        provider: 'ollama',
        model: 'llama2',
        messages: [{ role: 'user', content: 'Hello' }],
        apiKey: '',
      };

      for await (const _ of gateway.stream(request, '', 'http://localhost:11434')) {
        // consume
      }

      expect(mockStream).toHaveBeenCalledWith(
        'llama2',
        [{ role: 'user', content: 'Hello' }],
        '',
        expect.objectContaining({
          baseUrl: 'http://localhost:11434',
        }),
      );
    });
  });
});
