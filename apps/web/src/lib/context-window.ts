export type AgentMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

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

  let remaining = Math.max(0, budget - system.content.length);
  const newest = messages[messages.length - 1];
  if (!newest) return [system];

  const selected: AgentMessage[] = [newest];
  remaining -= newest.content.length;

  for (let index = messages.length - 2; index >= 1; index -= 1) {
    const message = messages[index];
    if (!message || message.content.length > remaining) continue;
    selected.push(message);
    remaining -= message.content.length;
  }

  selected.reverse();
  return [system, ...selected];
}
