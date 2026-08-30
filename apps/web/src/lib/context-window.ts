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
 * Keep the system prompt and newest conversation entries while staying under
 * the provider request budget. The newest user request is always retained;
 * unlike pair-based trimming, this also handles consecutive user messages
 * produced by clarifications and design-direction selections.
 */
export function trimMessagesForContext(
  messages: AgentMessage[],
  budget = CONTEXT_BUDGET_CHARS,
): AgentMessage[] {
  if (messages.length <= 1) return messages;

  const system = messages[0];
  if (!system || system.role !== 'system') return messages;

  let remaining = Math.max(0, budget - messageSize(system));
  const newest = messages[messages.length - 1];
  if (!newest) return [system];

  const selected: AgentMessage[] = [newest];
  remaining -= messageSize(newest);

  for (let index = messages.length - 2; index >= 1; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    const size = messageSize(message);
    if (size > remaining) continue;
    selected.push(message);
    remaining -= size;
  }

  selected.reverse();
  return [system, ...selected];
}
