/**
 * Observability setup — OpenTelemetry, Sentry, structured logging.
 *
 * OpenTelemetry and Sentry are optional at compile time.
 * They activate only when their environment variables are set.
 */

// ─── Types ────────────────────────────────────────────────

export type LogLevel = 'info' | 'warn' | 'error';

export interface SpanInterface {
  end(): void;
  setAttribute(key: string, value: string | number | boolean): void;
  recordException(error: Error): void;
}

export interface LogEntry {
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

// ─── Sensitive field redaction ────────────────────────────

const REDACTED_FIELDS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'api_key',
  'apiKey',
  'api-key',
  'password',
  'passwordHash',
  'password_hash',
  'secret',
  'secretKey',
  'secret_key',
  'connectionString',
  'connection_string',
  'database_url',
  'DATABASE_URL',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'encrypted_token',
  'encryptedToken',
  'encrypted_key',
  'encryptedKey',
  'token_iv',
  'tokenIv',
  'token_auth_tag',
  'tokenAuthTag',
]);

function redact(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (REDACTED_FIELDS.has(key)) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = redact(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ─── Structured logging ───────────────────────────────────

export function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  const entry: LogEntry = {
    level,
    message,
    data: data ? redact(data) : undefined,
    timestamp: new Date().toISOString(),
  };

  const output = JSON.stringify(entry);

  switch (level) {
    case 'error':
      console.error(output);
      break;
    case 'warn':
      console.warn(output);
      break;
    default:
      console.log(output);
  }
}

// ─── OpenTelemetry (optional) ─────────────────────────────

let tracer: { startSpan(name: string): SpanInterface } | null = null;

export function initTelemetry(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return;

  try {
    // Dynamic import — only loaded when OTEL is configured
    const { trace } = require('@opentelemetry/api');
    tracer = trace.getTracer('app-builder');
    log('info', 'OpenTelemetry initialized', { endpoint });
  } catch {
    log('warn', 'OpenTelemetry packages not installed — tracing disabled');
  }
}

export function createSpan(name: string): SpanInterface {
  if (tracer) {
    const span = tracer.startSpan(name);
    return span;
  }

  // No-op fallback when telemetry is not configured
  return {
    end() {},
    setAttribute() {},
    recordException() {},
  };
}

// ─── Sentry (optional) ────────────────────────────────────

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  log('error', message, {
    ...context,
    stack,
    name: error instanceof Error ? error.name : 'Unknown',
  });

  // Sentry integration — activate when @sentry/nextjs is installed:
  // import * as Sentry from '@sentry/nextjs';
  // Sentry.captureException(error, { extra: context });
}
