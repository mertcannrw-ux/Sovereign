import { describe, expect, it } from 'vitest';
import {
  validateGeneratePayload,
  parseProvider,
  buildAgentSystemPrompt,
  formatReadObservation,
  encodeEvent,
  createAsyncQueue,
  AGENT_SYSTEM_PROMPT,
  NATIVE_TOOLS_SYSTEM_PROMPT,
} from './index';

describe('agent service validation', () => {
  it('parses supported AI providers', () => {
    expect(parseProvider('anthropic')).toBe('anthropic');
    expect(parseProvider('openai')).toBe('openai');
    expect(() => parseProvider('invalid-provider')).toThrow('Unsupported AI provider');
  });

  it('rejects missing JSON body or non-objects', () => {
    expect(validateGeneratePayload(null)).toEqual({
      ok: false,
      error: 'Invalid JSON body',
    });
    expect(validateGeneratePayload('string')).toEqual({
      ok: false,
      error: 'Invalid JSON body',
    });
  });

  it('rejects missing generation inputs', () => {
    expect(validateGeneratePayload({})).toEqual({
      ok: false,
      error: 'Missing generation input',
    });
    expect(
      validateGeneratePayload({
        projectId: 'p1',
        modelProvider: 'anthropic',
      }),
    ).toEqual({
      ok: false,
      error: 'Missing generation input',
    });
    expect(
      validateGeneratePayload({
        projectId: 'p1',
        message: 'hello',
        modelProvider: 'anthropic',
      }),
    ).toEqual({
      ok: false,
      error: 'Missing generation input',
    });
  });

  it('validates directionResponse input requirements', () => {
    expect(
      validateGeneratePayload({
        directionResponse: { action: 'select', setId: 's1' },
      }),
    ).toEqual({
      ok: false,
      error: 'Missing generation input for direction response',
    });
  });

  it('validates attachment limits', () => {
    const hugeContent = 'a'.repeat(600 * 1024);
    expect(
      validateGeneratePayload({
        projectId: 'p1',
        message: 'hello',
        modelProvider: 'anthropic',
        modelName: 'claude-3-5-sonnet',
        files: [{ path: 'file.txt', content: hugeContent }],
      }),
    ).toEqual({
      // Single file > 100 KB is ignored in count, but 6 files of 90 KB exceed 512 KB
      ok: true,
      data: expect.any(Object),
    });

    const sixFiles = Array.from({ length: 6 }, (_, i) => ({
      path: `file${i}.txt`,
      content: 'b'.repeat(90 * 1024),
    }));
    expect(
      validateGeneratePayload({
        projectId: 'p1',
        message: 'hello',
        modelProvider: 'anthropic',
        modelName: 'claude-3-5-sonnet',
        files: sixFiles,
      }),
    ).toEqual({
      ok: false,
      error: 'Attachments exceed 512 KB total',
    });
  });

  it('accepts valid payload', () => {
    const valid = {
      projectId: 'p1',
      message: 'Build a counter app',
      modelProvider: 'anthropic',
      modelName: 'claude-3-5-sonnet-20241022',
    };
    const res = validateGeneratePayload(valid);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.projectId).toBe('p1');
    }
  });
});

describe('prompts & formatting', () => {
  it('builds system prompt according to tools and runtime flags', () => {
    expect(buildAgentSystemPrompt(false, false)).toBe(AGENT_SYSTEM_PROMPT);
    expect(buildAgentSystemPrompt(true, false)).toBe(NATIVE_TOOLS_SYSTEM_PROMPT);
    const withRuntime = buildAgentSystemPrompt(true, true);
    expect(withRuntime).toContain('Sandbox verification ("run"):');
  });

  it('formats read observations with line bounds and headers', () => {
    const content = 'line 1\nline 2\nline 3\nline 4';
    const obs = formatReadObservation(
      'src/App.tsx',
      content,
      { path: 'src/App.tsx', startLine: 2, endLine: 3 },
      1000,
    );
    expect(obs).toContain('--- src/App.tsx (lines 2-3) ---');
    expect(obs).toContain('2: line 2');
    expect(obs).toContain('3: line 3');
    expect(obs).not.toContain('1: line 1');
  });

  it('handles read observation when file is not found', () => {
    const obs = formatReadObservation(
      'src/missing.tsx',
      undefined,
      { path: 'src/missing.tsx' },
      1000,
    );
    expect(obs).toBe('--- src/missing.tsx ---\n[not found]');
  });
});

describe('SSE events & async queue', () => {
  it('encodes SSE events properly', () => {
    const encoded = encodeEvent('phase', { phase: 'building', label: 'Compiling' });
    const text = new TextDecoder().decode(encoded);
    expect(text).toBe('event: phase\ndata: {"phase":"building","label":"Compiling"}\n\n');
  });
  it('createAsyncQueue delivers items in order and terminates on end', async () => {
    const queue = createAsyncQueue<number>();
    queue.push(1);
    queue.push(2);
    queueMicrotask(() => {
      queue.push(3);
      queue.end();
    });
    const results: number[] = [];
    for await (const item of queue) {
      results.push(item);
    }
    expect(results).toEqual([1, 2, 3]);
  });
});
