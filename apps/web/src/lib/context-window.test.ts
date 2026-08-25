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
});
