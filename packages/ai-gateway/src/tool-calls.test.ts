import { describe, expect, it } from 'vitest';
import {
  applyOpenAIToolCallDeltas,
  mapGatewayMessagesToOpenAI,
  parseOpenAIToolCalls,
} from './tool-calls';

describe('applyOpenAIToolCallDeltas', () => {
  it('assembles a single tool call from id, name, then argument fragments', () => {
    let calls = applyOpenAIToolCallDeltas(
      [],
      [{ index: 0, id: 'call_1', function: { name: 'write_file' } }],
    );
    calls = applyOpenAIToolCallDeltas(calls, [{ index: 0, function: { arguments: '{"path":"' } }]);
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
    const calls = applyOpenAIToolCallDeltas(
      [],
      [
        { index: 1, id: 'b', function: { name: 'delete_file', arguments: '{"path":"a.ts"}' } },
        { index: 0, id: 'a', function: { name: 'read_files', arguments: '{}' } },
      ],
    );
    expect(calls[0]?.id).toBe('a');
    expect(calls[1]?.id).toBe('b');
    expect(calls[0]?.function.name).toBe('read_files');
    expect(calls[1]?.function.name).toBe('delete_file');
  });
});

describe('applyOpenAIToolCallDeltas index validation', () => {
  // A provider can emit any JSON, so `index` must never be trusted: a negative
  // or fractional value used to make `current.id = …` throw, and an oversized
  // one used to spin a multi-billion-iteration fill loop.
  const invalidDeltas = [
    { index: -1, id: 'neg', function: { name: 'x', arguments: 'NEGATIVE' } },
    { index: 0.5, id: 'frac', function: { name: 'x', arguments: 'FRACTIONAL' } },
    { index: 1e9, id: 'huge', function: { name: 'x', arguments: 'HUGE' } },
    { index: Number.NaN, function: { arguments: 'NAN' } },
  ];

  it('ignores deltas with a negative, fractional, NaN, or oversized index', () => {
    const seeded = applyOpenAIToolCallDeltas(
      [],
      [{ index: 0, id: 'call_1', function: { name: 'write_file', arguments: '{"a":' } }],
    );

    const calls = applyOpenAIToolCallDeltas(seeded, invalidDeltas);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      id: 'call_1',
      type: 'function',
      function: { name: 'write_file', arguments: '{"a":' },
    });
  });

  it('never throws on a malformed index', () => {
    expect(() => applyOpenAIToolCallDeltas([], invalidDeltas)).not.toThrow();
    expect(applyOpenAIToolCallDeltas([], invalidDeltas)).toEqual([]);
  });

  it('still accumulates arguments for a valid index', () => {
    let calls = applyOpenAIToolCallDeltas(
      [],
      [{ index: 0, id: 'call_1', function: { name: 'write_file', arguments: '{"a":' } }],
    );
    calls = applyOpenAIToolCallDeltas(calls, [{ index: 0, function: { arguments: '1}' } }]);
    calls = applyOpenAIToolCallDeltas(calls, [
      { index: 1, id: 'call_2', function: { name: 'read_files', arguments: '{}' } },
    ]);

    expect(calls).toHaveLength(2);
    expect(calls[0]?.function.arguments).toBe('{"a":1}');
    expect(calls[1]).toEqual({
      id: 'call_2',
      type: 'function',
      function: { name: 'read_files', arguments: '{}' },
    });
  });

  it('treats a missing index as the first tool call', () => {
    const calls = applyOpenAIToolCallDeltas([], [{ function: { arguments: '{}' } }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.function.arguments).toBe('{}');
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
    ).toEqual([{ id: 'call_9', type: 'function', function: { name: 'finish', arguments: '{}' } }]);
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
