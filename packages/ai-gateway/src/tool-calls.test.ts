import { describe, expect, it } from 'vitest';
import {
  applyOpenAIToolCallDeltas,
  mapGatewayMessagesToOpenAI,
  parseOpenAIToolCalls,
} from './tool-calls';

describe('applyOpenAIToolCallDeltas', () => {
  it('assembles a single tool call from id, name, then argument fragments', () => {
    let calls = applyOpenAIToolCallDeltas([], [
      { index: 0, id: 'call_1', function: { name: 'write_file' } },
    ]);
    calls = applyOpenAIToolCallDeltas(calls, [
      { index: 0, function: { arguments: '{"path":"' } },
    ]);
    calls = applyOpenAIToolCallDeltas(calls, [
      { index: 0, function: { arguments: 'src/App.tsx"}' } },
    ]);
    expect(calls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'write_file', arguments: '{"path":"src/App.tsx"}' },
      },
    ]);
  });

  it('assembles parallel tool calls by index', () => {
    const calls = applyOpenAIToolCallDeltas([], [
      { index: 1, id: 'b', function: { name: 'delete_file', arguments: '{"path":"a.ts"}' } },
      { index: 0, id: 'a', function: { name: 'read_files', arguments: '{}' } },
    ]);
    expect(calls[0]?.id).toBe('a');
    expect(calls[1]?.id).toBe('b');
    expect(calls[0]?.function.name).toBe('read_files');
    expect(calls[1]?.function.name).toBe('delete_file');
  });
});

describe('parseOpenAIToolCalls', () => {
  it('reads a non-streaming message.tool_calls array', () => {
    expect(
      parseOpenAIToolCalls([
        {
          id: 'call_9',
          type: 'function',
          function: { name: 'finish', arguments: '{}' },
        },
      ]),
    ).toEqual([
      { id: 'call_9', type: 'function', function: { name: 'finish', arguments: '{}' } },
    ]);
  });

  it('skips entries without a function name', () => {
    expect(parseOpenAIToolCalls([{ id: 'x', function: { arguments: '{}' } }])).toEqual([]);
  });
});

describe('mapGatewayMessagesToOpenAI', () => {
  it('maps tool results and assistant toolCalls to the Chat Completions wire format', () => {
    const payload = mapGatewayMessagesToOpenAI([
      { role: 'system', content: 'You are an agent.' },
      { role: 'user', content: 'Edit the file' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_files', arguments: '{"files":[{"path":"a.ts"}]}' },
          },
        ],
      },
      { role: 'tool', toolCallId: 'call_1', content: 'read_files result' },
    ]);
    expect(payload[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'read_files', arguments: '{"files":[{"path":"a.ts"}]}' },
        },
      ],
    });
    expect(payload[3]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'read_files result',
    });
  });
});
