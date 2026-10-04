import { describe, it, expect } from 'vitest';
import {
  buildContext,
  parseResponse,
  normalizePath,
  validatePath,
  validateChanges,
  buildSystemPrompt,
  generate,
} from './engine';
import type { EngineConfig, SystemPromptContext } from './types';

const CONFIG: EngineConfig = {
  techStack: {
    framework: 'react',
    language: 'typescript',
    styling: 'tailwind',
    components: 'shadcn',
    bundler: 'vite',
  },
};

function budget(overrides: Partial<SystemPromptContext['budget']> = {}) {
  return {
    maxInputTokens: 128000,
    maxOutputFiles: 50,
    maxOutputBytes: 5 * 1024 * 1024,
    ...overrides,
  };
}

describe('buildContext', () => {
  it('maps params into the system prompt context', () => {
    const context = buildContext({
      manifest: { 'package.json': 'hash1' },
      files: [{ path: 'package.json', content: '{}' }],
      requirements: 'Create a todo app',
      projectName: 'Todo',
      projectDescription: 'A simple list',
      config: { ...CONFIG, maxTokens: 4096 },
    });

    expect(context.manifest).toEqual({ 'package.json': 'hash1' });
    expect(context.relevantFiles).toEqual([{ path: 'package.json', content: '{}' }]);
    expect(context.userRequirements).toBe('Create a todo app');
    expect(context.projectSettings.name).toBe('Todo');
    expect(context.projectSettings.description).toBe('A simple list');
    expect(context.budget.maxInputTokens).toBe(4096);
    expect(context.budget.maxOutputFiles).toBe(50);
  });

  it('defaults maxInputTokens when config.maxTokens is absent', () => {
    const context = buildContext({
      manifest: {},
      files: [],
      requirements: '',
      projectName: 'X',
      config: CONFIG,
    });

    expect(context.budget.maxInputTokens).toBe(128000);
  });
});

describe('parseResponse', () => {
  it('parses a bare JSON tool output', () => {
    const raw = JSON.stringify({
      message: 'Created the entry point',
      changes: [{ path: 'src/index.ts', operation: 'write', content: 'console.log(1)' }],
    });

    const result = parseResponse(raw);
    expect(result.version).toBe(1);
    expect(result.message).toBe('Created the entry point');
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.operation).toBe('write');
  });

  it('extracts JSON from a markdown code block', () => {
    const raw = 'Here you go:\n```json\n{"message":"ok","changes":[]}\n```\n';

    const result = parseResponse(raw);
    expect(result.message).toBe('ok');
    expect(result.changes).toEqual([]);
  });

  it('rejects output missing the message field', () => {
    expect(() => parseResponse(JSON.stringify({ changes: [] }))).toThrow(/message/);
  });

  it('rejects output with an invalid operation', () => {
    const raw = JSON.stringify({
      message: 'x',
      changes: [{ path: 'a.ts', operation: 'rename' }],
    });
    expect(() => parseResponse(raw)).toThrow(/invalid operation/);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseResponse('not json')).toThrow(/Failed to parse AI response/);
  });
});

describe('normalizePath', () => {
  it('strips a leading ./ and normalizes separators', () => {
    expect(normalizePath('./src/index.ts')).toBe('src/index.ts');
    expect(normalizePath('src\\index.ts')).toBe('src/index.ts');
    expect(normalizePath('src/')).toBe('src');
  });
});

describe('validatePath', () => {
  it('returns the normalized path for safe paths', () => {
    expect(validatePath('./src/index.ts')).toBe('src/index.ts');
    expect(validatePath('package.json')).toBe('package.json');
  });

  it('returns null for traversal, absolute and backslash paths', () => {
    expect(validatePath('../etc/passwd')).toBeNull();
    expect(validatePath('/etc/passwd')).toBeNull();
    expect(validatePath('C:/Windows/system32')).toBeNull();
    expect(validatePath('src\\index.ts')).toBeNull();
  });
});

describe('validateChanges', () => {
  it('marks writes as CREATE when the path is new', () => {
    const result = validateChanges(
      [{ path: 'src/index.ts', operation: 'write', content: 'export {}' }],
      {},
      budget(),
    );

    expect(result.diagnostics).toHaveLength(0);
    expect(result.valid).toEqual([
      { path: 'src/index.ts', operation: 'CREATE', content: 'export {}' },
    ]);
  });

  it('marks writes as UPDATE when the path exists in the manifest', () => {
    const result = validateChanges(
      [{ path: 'src/index.ts', operation: 'write', content: 'export {}' }],
      { 'src/index.ts': 'hash' },
      budget(),
    );

    expect(result.valid[0]!.operation).toBe('UPDATE');
  });

  it('maps delete to DELETE and drops ask_user', () => {
    const result = validateChanges(
      [
        { path: 'src/old.ts', operation: 'delete' },
        { path: 'src/ask.ts', operation: 'ask_user' },
      ],
      { 'src/old.ts': 'hash' },
      budget(),
    );

    expect(result.valid).toEqual([{ path: 'src/old.ts', operation: 'DELETE', content: undefined }]);
  });

  it('rejects duplicate normalized paths', () => {
    const result = validateChanges(
      [
        { path: 'src/index.ts', operation: 'write', content: 'a' },
        { path: './src/index.ts', operation: 'write', content: 'b' },
      ],
      {},
      budget(),
    );

    expect(result.valid).toHaveLength(1);
    expect(result.diagnostics.some((d) => /Duplicate/.test(d.message))).toBe(true);
  });

  it('rejects files exceeding the size budget', () => {
    const result = validateChanges(
      [{ path: 'big.ts', operation: 'write', content: 'a'.repeat(2048) }],
      {},
      budget({ maxOutputBytes: 1024 }),
    );

    expect(result.valid).toHaveLength(0);
    expect(result.diagnostics.some((d) => /budget/.test(d.message))).toBe(true);
  });
});

describe('buildSystemPrompt', () => {
  it('includes the project name, tech stack and manifest', () => {
    const context: SystemPromptContext = {
      manifest: { 'package.json': 'abcdef1234567890' },
      relevantFiles: [{ path: 'package.json', content: '{}' }],
      userRequirements: 'Add a search box',
      projectSettings: { name: 'Todo', techStack: CONFIG.techStack },
      budget: budget(),
    };

    const prompt = buildSystemPrompt(context);
    expect(prompt).toContain('Project: Todo');
    expect(prompt).toContain('Framework: react');
    expect(prompt).toContain('package.json (abcdef12)');
  });
});

describe('generate', () => {
  it('runs the parse → validate pipeline and reports success', async () => {
    const raw = JSON.stringify({
      message: 'done',
      changes: [{ path: 'src/index.ts', operation: 'write', content: 'export {}' }],
    });

    const result = await generate({ rawResponse: raw, manifest: {}, config: CONFIG });

    expect(result.finishReason).toBe('complete');
    expect(result.changes).toHaveLength(1);
    expect(result.usage.totalTokens).toBe(0);
  });

  it('reports failure when validation produces errors', async () => {
    const raw = JSON.stringify({
      message: 'done',
      changes: [{ path: '../escape.ts', operation: 'write', content: 'x' }],
    });

    const result = await generate({ rawResponse: raw, manifest: {}, config: CONFIG });

    expect(result.finishReason).toBe('failed');
    expect(result.changes).toHaveLength(0);
  });
});
