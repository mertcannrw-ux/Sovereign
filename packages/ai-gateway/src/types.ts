import type { AIProvider } from '@app-builder/shared';

export type { GatewayMessage, ToolCall } from './tool-calls';

/**
 * Options passed to a provider alongside the standard completion params.
 * `baseUrl` — override the provider's default API endpoint (required for Ollama,
 * optional for others such as self-hosted/private endpoints).
 */
export interface ProviderCompleteOptions {
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: string;
  /** Optional abort signal — cancels the upstream request when aborted. */
  signal?: AbortSignal;
  /**
   * Stable identifier for the conversation this request belongs to. Sent as
   * `x-opencode-session` to OpenCode's gateway, which routes and caches per
   * session and rejects requests that omit it; other providers ignore it.
   */
  sessionId?: string;
  tools?: {
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }[];
  toolChoice?: 'auto' | 'none' | 'required';
}

// ─── Errors ───────────────────────────────────────────────

/**
 * Structured error thrown by any provider when the upstream API
 * returns a non-2xx response.
 */
export class ProviderError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly provider: AIProvider;

  constructor(provider: AIProvider, status: number, code: string, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
    this.code = code;
  }
}
