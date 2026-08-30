export type ToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type GatewayMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function emptyToolCall(): ToolCall {
  return { id: '', type: 'function', function: { name: '', arguments: '' } };
}

/**
 * Assemble OpenAI streaming `delta.tool_calls` fragments by `index`.
 * Fragments may omit id/name and only append `function.arguments`.
 */
export function applyOpenAIToolCallDeltas(accumulated: ToolCall[], deltas: unknown): ToolCall[] {
  if (!Array.isArray(deltas)) return accumulated;
  const next = accumulated.map((call) => ({
    ...call,
    function: { ...call.function },
  }));

  for (const delta of deltas) {
    if (!isObject(delta)) continue;
    const index = typeof delta['index'] === 'number' ? delta['index'] : 0;
    while (next.length <= index) next.push(emptyToolCall());
    const current = next[index]!;
    if (isString(delta['id']) && delta['id'].length > 0) current.id = delta['id'];
    const fn = delta['function'];
    if (!isObject(fn)) continue;
    if (isString(fn['name']) && fn['name'].length > 0) {
      current.function.name += fn['name'];
    }
    if (isString(fn['arguments'])) {
      current.function.arguments += fn['arguments'];
    }
  }
  return next;
}

export function parseOpenAIToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  const calls: ToolCall[] = [];
  for (const item of raw) {
    if (!isObject(item)) continue;
    const fn = item['function'];
    const name = isObject(fn) && isString(fn['name']) ? fn['name'] : '';
    const args = isObject(fn) && isString(fn['arguments']) ? fn['arguments'] : '{}';
    const id = isString(item['id']) ? item['id'] : '';
    if (!name) continue;
    calls.push({
      id,
      type: 'function',
      function: { name, arguments: args },
    });
  }
  return calls;
}

export function mapGatewayMessagesToOpenAI(messages: GatewayMessage[]): Record<string, unknown>[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: message.content.length > 0 ? message.content : null,
        tool_calls: message.toolCalls,
      };
    }
    return { role: message.role, content: message.content };
  });
}
