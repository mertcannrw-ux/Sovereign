import { describe, expect, it } from 'vitest';
import {
  SOVEREIGN_RUNTIME_TOOL,
  SOVEREIGN_TOOLS,
  actionsFromToolCalls,
  parseToolCallAction,
} from '@/lib/agent-tools';

describe('parseToolCallAction', () => {
  it('maps a write_file tool call onto the existing agent action parser', () => {
    const action = parseToolCallAction(
      'write_file',
      JSON.stringify({ path: 'src/App.tsx', content: 'export const App = () => null;' }),
    );
    expect(action).toEqual({
      type: 'write_file',
      path: 'src/App.tsx',
      content: 'export const App = () => null;',
    });
  });

  it('rejects invalid JSON arguments', () => {
    expect(() => parseToolCallAction('read_files', '{')).toThrow('not valid JSON');
  });
});

describe('actionsFromToolCalls', () => {
  it('batches multiple tool calls', () => {
    const action = actionsFromToolCalls([
      {
        id: '1',
        function: { name: 'delete_file', arguments: JSON.stringify({ path: 'old.ts' }) },
      },
      {
        id: '2',
        function: {
          name: 'read_files',
          arguments: JSON.stringify({ files: [{ path: 'src/App.tsx' }] }),
        },
      },
    ]);
    expect(action.type).toBe('batch');
    if (action.type === 'batch') {
      expect(action.actions.map((item) => item.type)).toEqual(['delete_file', 'read_files']);
    }
  });
});

describe('runtime tool gating', () => {
  it('keeps `run` out of the base tool set and lists only allowlisted commands', () => {
    expect(SOVEREIGN_TOOLS.some((tool) => tool.function.name === 'run')).toBe(false);
    expect(SOVEREIGN_RUNTIME_TOOL.function.name).toBe('run');
    expect(SOVEREIGN_RUNTIME_TOOL.function.parameters).toMatchObject({
      required: ['command'],
      properties: {
        command: { type: 'string', enum: ['npm install', 'npx tsc --noEmit', 'npx vite build'] },
      },
    });
  });

  it('maps a run tool call onto the run action', () => {
    expect(parseToolCallAction('run', JSON.stringify({ command: 'npm install' }))).toEqual({
      type: 'run',
      command: 'npm install',
    });
  });
});
