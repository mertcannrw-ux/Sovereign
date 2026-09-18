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
 * Upper bound for a streamed tool-call `index`. OpenAI returns at most a
 * handful of parallel tool calls, so anything larger is a malformed stream:
 * honouring it would grow the accumulator array towards the value.
 */
const MAX_TOOL_CALL_INDEX = 256;

/**
 * Assemble OpenAI streaming `delta.tool_calls` fragments by `index`.
 * Fragments may omit id/name and only append `function.arguments`.
 *
 * `index` is provider-controlled data, so it is validated before use: a
 * negative, fractional, non-finite, or oversized value would index out of
 * bounds (`current.id = …` throws on `undefined`) or spin a huge fill loop. A
 * malformed delta is skipped rather than aborting the whole stream.
 */
export function applyOpenAIToolCallDeltas(accumulated: ToolCall[], deltas: unknown): ToolCall[] {
  if (!Array.isArray(deltas)) return accumulated;
  const next = accumulated.map((call) => ({
    ...call,
    function: { ...call.function },
  }));

  for (const delta of deltas) {
    if (!isObject(delta)) continue;
    const rawIndex = delta['index'];
    // A delta without an index targets the first call (OpenAI behaviour).
    const index = typeof rawIndex === 'number' ? rawIndex : 0;
    if (!Number.isInteger(index) || index < 0 || index > MAX_TOOL_CALL_INDEX) continue;
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
