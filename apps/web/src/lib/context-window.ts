import type { GatewayMessage } from '@app-builder/ai-gateway';

export type AgentMessage = GatewayMessage;

function messageSize(message: AgentMessage): number {
  if (message.role === 'tool') return message.content.length + message.toolCallId.length;
  if (message.role === 'assistant') {
    const tools = message.toolCalls ? JSON.stringify(message.toolCalls).length : 0;
    return message.content.length + tools;
  }
  return message.content.length;
}

/**
 * Character budget for the serialized conversation sent to the provider.
 * This is deliberately conservative because the app supports providers with
 * different tokenizers and context limits.
 */
export const CONTEXT_BUDGET_CHARS = 80_000;

/**
 * Inclusion unit: an assistant message that carries `toolCalls` together with
 * the `tool`-role results that follow it. Providers reject any request where a
 * tool result has no preceding assistant `tool_calls` (or vice versa), so a run
 * must be kept or dropped as a whole.
 */
interface Block {
  messages: AgentMessage[];
  size: number;
}

/**
 * Groups messages (excluding index 0) into blocks. Every `tool` result belongs
 * to the assistant-with-toolCalls immediately before it; the agent loop always
 * appends tool results directly after their owning assistant message, so a run
 * is the assistant message plus its contiguous trailing `tool` messages.
 */
function buildBlocks(messages: AgentMessage[]): Block[] {
  const blocks: Block[] = [];
  let index = 1;
  while (index < messages.length) {
    const message = messages[index]!;
    if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
      const run: AgentMessage[] = [message];
      let size = messageSize(message);
      let cursor = index + 1;
      while (cursor < messages.length && messages[cursor]!.role === 'tool') {
        const tool = messages[cursor]!;
        run.push(tool);
        size += messageSize(tool);
        cursor += 1;
      }
      blocks.push({ messages: run, size });
      index = cursor;
    } else {
      blocks.push({ messages: [message], size: messageSize(message) });
      index += 1;
    }
  }
  return blocks;
}

/**
 * Keep the system prompt and newest conversation entries while staying under
 * the provider request budget. The newest block is always retained; unlike
 * pair-based trimming, this also handles consecutive user messages produced by
 * clarifications and design-direction selections. Plain messages are selected
 * individually (newest first), tool-call runs atomically, so a kept assistant
 * always ships with its tool results and no orphan tool message survives.
 */
export function trimMessagesForContext(
  messages: AgentMessage[],
  budget = CONTEXT_BUDGET_CHARS,
): AgentMessage[] {
  if (messages.length <= 1) return messages;

  const system = messages[0];
  if (!system || system.role !== 'system') return messages;

  const blocks = buildBlocks(messages);
  const newestBlock = blocks[blocks.length - 1];
  if (!newestBlock) return [system];

  const selected: AgentMessage[] = [];
  let remaining = Math.max(0, budget - messageSize(system));

  // `selected` is accumulated newest-first and reversed below, so multi-message
  // blocks must be pushed in reverse to preserve their internal order.
  const pushBlock = (block: Block) => {
    for (let i = block.messages.length - 1; i >= 0; i -= 1) {
      selected.push(block.messages[i]!);
    }
  };

  // The current request (or the tool-call run containing it) is always retained.
  pushBlock(newestBlock);
  remaining -= newestBlock.size;

  for (let index = blocks.length - 2; index >= 0; index -= 1) {
    const block = blocks[index]!;
    if (block.size > remaining) continue;
    pushBlock(block);
    remaining -= block.size;
  }

  selected.reverse();
  return [system, ...selected];
}
