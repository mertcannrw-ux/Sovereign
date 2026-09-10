import { describe, expect, it } from 'vitest';
import { actionsFromToolCalls, parseToolCallAction } from '@/lib/agent-tools';

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
