import { describe, expect, it } from 'vitest';
import { trimMessagesForContext } from '@/lib/context-window';

describe('trimMessagesForContext', () => {
  it('keeps the newest request when history contains consecutive user messages', () => {
    const messages = [
      { role: 'system' as const, content: 'system' },
      { role: 'user' as const, content: 'old request' },
      { role: 'assistant' as const, content: 'old answer' },
      { role: 'user' as const, content: 'clarification one' },
      { role: 'user' as const, content: 'clarification two' },
      { role: 'assistant' as const, content: 'latest answer' },
      { role: 'user' as const, content: 'current request' },
    ];

    const trimmed = trimMessagesForContext(messages, 43);

    expect(trimmed[0]).toEqual(messages[0]);
    expect(trimmed.at(-1)).toEqual(messages.at(-1));
    expect(trimmed.map((message) => message.content)).toEqual([
      'system',
      'latest answer',
      'current request',
    ]);
  });

  it('preserves message order after selecting the newest entries', () => {
    const messages = [
      { role: 'system' as const, content: 's' },
      { role: 'user' as const, content: 'old' },
      { role: 'assistant' as const, content: 'middle' },
      { role: 'user' as const, content: 'new' },
    ];

    expect(trimMessagesForContext(messages, 12).map((message) => message.content)).toEqual([
      's',
      'middle',
      'new',
    ]);
  });

  it('drops an oversized tool-call run entirely instead of orphaning its tool results', () => {
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'request' },
      {
        role: 'assistant' as const,
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function' as const,
            function: { name: 'write_file', arguments: '{}' },
          },
        ],
      },
      // The assistant message alone is ~97 chars (it serializes toolCalls) and
      // this tool result is 212 chars, so the run is ~309 chars — dwarfing the
      // 240-char budget even though each piece would fit on its own.
      { role: 'tool' as const, toolCallId: 'call_1', content: `wrote ${'x'.repeat(200)}` },
      { role: 'user' as const, content: 'next' },
    ];

    const trimmed = trimMessagesForContext(messages, 240);

    // Neither the assistant nor its tool result may survive alone; the plain
    // 'request' and the newest 'next' message still fit.
    expect(trimmed.map((message) => message.role)).toEqual(['system', 'user', 'user']);
    expect(trimmed.some((message) => message.role === 'tool')).toBe(false);
    expect(trimmed.some((message) => message.role === 'assistant')).toBe(false);
    expect(trimmed.at(-1)).toEqual(messages.at(-1));
  });

  it('keeps the whole tool-call run when it fits, preserving tool-result order', () => {
    const messages = [
      { role: 'system' as const, content: 'sys' },
      {
        role: 'assistant' as const,
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function' as const,
            function: { name: 'read_files', arguments: '{}' },
          },
          {
            id: 'call_2',
            type: 'function' as const,
            function: { name: 'read_files', arguments: '{}' },
          },
        ],
      },
      { role: 'tool' as const, toolCallId: 'call_1', content: 'result one' },
      { role: 'tool' as const, toolCallId: 'call_2', content: 'result two' },
      { role: 'user' as const, content: 'next' },
    ];

    const trimmed = trimMessagesForContext(messages, 400);

    expect(trimmed.map((message) => message.role)).toEqual([
      'system',
      'assistant',
      'tool',
      'tool',
      'user',
    ]);
    expect(trimmed.at(-1)).toEqual(messages.at(-1));
  });

  it('never lets a tool result survive when its owning assistant was trimmed', () => {
    // Budget large enough for the newest message and the middle plain message
    // but not for either tool-call run. The old per-message trimmer kept both
    // small tool results while dropping their (file-body-heavy) assistants,
    // producing orphaned tool messages that providers reject.
    const messages = [
      { role: 'system' as const, content: 'sys' },
      { role: 'user' as const, content: 'oldest request' },
      {
        role: 'assistant' as const,
        content: '',
        toolCalls: [
          {
            id: 'call_0',
            type: 'function' as const,
            function: { name: 'write_file', arguments: '{}' },
          },
        ],
      },
      { role: 'tool' as const, toolCallId: 'call_0', content: 'oldest result' },
      { role: 'user' as const, content: 'middle request' },
      {
        role: 'assistant' as const,
        content: '',
        toolCalls: [
          {
            id: 'call_1',
            type: 'function' as const,
            function: { name: 'write_file', arguments: '{}' },
          },
        ],
      },
      { role: 'tool' as const, toolCallId: 'call_1', content: 'result' },
      { role: 'user' as const, content: 'new' },
    ];

    // Budget large enough for the oldest run + newest message, but not the
    // middle run (whose tool result alone would fit under per-message rules).
    const trimmed = trimMessagesForContext(messages, 60);

    const toolCallIds = trimmed
      .filter((message) => message.role === 'tool')
      .map((message) => (message.role === 'tool' ? message.toolCallId : null));
    const keptAssistantIds = trimmed
      .filter((message) => message.role === 'assistant')
      .map((message) => (message.toolCalls ? message.toolCalls[0]!.id : null));
    for (const id of keptAssistantIds) {
      if (id) expect(toolCallIds).toContain(id);
    }
    for (const id of toolCallIds) {
      expect(keptAssistantIds).toContain(id);
    }
  });
});
