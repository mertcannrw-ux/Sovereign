import type { ClarifyingQuestion, GeneratedFile } from '@/lib/generation-protocol';
import type { AgentStep } from '@/lib/agent-protocol';

export interface GenerationPhaseEvent {
  phase: 'planning' | 'generating' | 'building';
  label: string;
}

/**
 * Shape of the file the agent is currently streaming: content so far plus the
 * 1-indexed line / 0-indexed column where the model is writing. Mirrors the
 * server's `file-preview` streaming payloads.
 */
export interface ActiveFileState extends GeneratedFile {
  line: number;
  column: number;
}

export interface FileOperationEvent {
  operation: 'create' | 'update' | 'delete';
  path: string;
  content?: string;
  versionNumber: number;
}

export interface FilePreviewEvent {
  operation: 'create' | 'update' | 'delete';
  path: string;
  content?: string;
  /**
   * Position where the model is currently writing (1-indexed line, 0-indexed
   * column), included on streaming preview emissions. Absent on rollback
   * emissions, which restore prior content rather than stream new text.
   */
  line?: number;
  column?: number;
}

/**
 * A `run` tool call the server wants executed in this browser's WebContainer.
 * The client executes it and POSTs the result to
 * `/api/generate/runtime/{requestId}`; the generation stream is blocked until
 * that POST lands (or the budget expires).
 */
export interface RuntimeRequestEventData {
  requestId: string;
  toolCallId?: string;
  /** Allowlisted command string, e.g. `npx tsc --noEmit`. */
  command: string;
  timeoutMs?: number;
}

/**
 * Periodic frame emitted while the server waits on a browser-executed `run`
 * tool call. Its purpose is transport-level: `waitForRuntimeResult` fires
 * `onHeartbeat` every `RUNTIME_HEARTBEAT_MS` so an idle-timeout-happy proxy
 * does not cut the SSE connection during a long `npm install`. No UI state
 * consumes it — `useGeneration` has no branch for it, so the frame ends in
 * that handler's catch-all no-op. It is a keep-alive, not a progress signal.
 * Carries nothing beyond the request it belongs to.
 */
export interface RuntimeHeartbeatEventData {
  requestId: string;
}

export interface ImageJobEventData {
  id: string;
  status: 'running' | 'complete' | 'failed';
  semanticUse?: string;
  prompt?: string;
  placeholderToken?: string;
  publicUrl?: string;
  assetId?: string;
  error?: string;
}

export interface DesignDirectionRecord {
  id: string;
  orderNumber: number;
  title: string;
  visualBrief: string;
  imagePrompt: string;
  palette: unknown;
  typography: unknown;
  layoutNotes: string;
  /**
   * Prisma stores this as a free-form `String` column with no enum, so a row's
   * own type is `string`. The generate route is the only writer and narrows to
   * these literals at its two emit sites.
   */
  status: 'generating' | 'ready' | 'failed';
  previewAssetId?: string | null;
  errorMessage?: string | null;
  previewAsset?: {
    publicUrl: string;
  } | null;
}

export interface DesignDirectionsEventData {
  id: string;
  status: 'pending' | 'ready' | 'selected' | 'skipped' | 'failed';
  originalRequest: string;
  directions: DesignDirectionRecord[];
}

export interface GenerationQuestionsEvent {
  questions: ClarifyingQuestion[];
  userMessage: GenerationReadyEvent['userMessage'];
  assistantMessage: Omit<GenerationReadyEvent['assistantMessage'], 'tokenUsage'>;
}
export interface GenerationReadyEvent {
  userMessage: {
    id: string;
    role: string;
    content: string;
    timestamp: string;
    model: string | null;
  };
  assistantMessage: {
    id: string;
    role: string;
    content: string;
    timestamp: string;
    model: string | null;
    tokenUsage: { promptTokens: number; completionTokens: number; totalTokens: number };
  };
  thinking?: string;
  files: GeneratedFile[];
  versionNumber: number;
}
export type GenerationEvent =
  | { type: 'phase'; data: GenerationPhaseEvent }
  | { type: 'step'; data: AgentStep }
  | { type: 'file-operation'; data: FileOperationEvent }
  | { type: 'file-preview'; data: FilePreviewEvent }
  | { type: 'runtime-request'; data: RuntimeRequestEventData }
  | { type: 'runtime-heartbeat'; data: RuntimeHeartbeatEventData }
  | { type: 'thinking'; data: { content: string } }
  /**
   * Full snapshot of the user-facing answer text streamed so far (never a
   * delta): the transcript bubble replaces its text on every event and the
   * terminal `ready` message is authoritative. `content: ''` clears a bubble
   * whose turn turned out to be a tool call rather than an answer.
   */
  | { type: 'answer'; data: { content: string } }
  | { type: 'questions'; data: GenerationQuestionsEvent }
  | { type: 'image-job'; data: ImageJobEventData }
  | { type: 'design-directions'; data: DesignDirectionsEventData }
  | { type: 'ready'; data: GenerationReadyEvent }
  | { type: 'failed'; data: { message: string; code?: string } };

/**
 * Producer-side counterpart of `GenerationEvent`, keyed by event name so the
 * payload shape is checked at every emit site rather than only where the
 * consumer switches on it. Emitting an event that is not part of the contract
 * becomes a compile error instead of a frame the consumer silently drops.
 */
export type GenerationEventSink = <T extends GenerationEvent['type']>(
  event: T,
  data: Extract<GenerationEvent, { type: T }>['data'],
) => void;

/**
 * Every wire event name, as a TOTAL record over the union: adding an event to
 * `GenerationEvent` without listing it here is a compile error, and so is
 * listing a name the union does not declare. The hand-written `!==` chain this
 * replaces was how `runtime-heartbeat` came to be emitted by the server and
 * dropped on the floor by the consumer.
 */
const KNOWN_EVENT_TYPES: Record<GenerationEvent['type'], true> = {
  phase: true,
  step: true,
  'file-operation': true,
  'file-preview': true,
  'runtime-request': true,
  'runtime-heartbeat': true,
  thinking: true,
  answer: true,
  questions: true,
  'image-job': true,
  'design-directions': true,
  ready: true,
  failed: true,
};

function isKnownEventType(event: string): event is GenerationEvent['type'] {
  return Object.hasOwn(KNOWN_EVENT_TYPES, event);
}

function parseEventBlock(block: string): GenerationEvent | null {
  let event = '';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!event || data.length === 0) return null;
  if (!isKnownEventType(event)) return null;

  let payload: GenerationEvent['data'];
  try {
    payload = JSON.parse(data.join('\n')) as GenerationEvent['data'];
  } catch {
    return null;
  }
  return { type: event, data: payload } as GenerationEvent;
}

export async function consumeGenerationStream(
  response: Response,
  onEvent: (event: GenerationEvent) => void | Promise<void>,
): Promise<void> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      retryAfterMs?: number;
    } | null;
    const hint =
      typeof payload?.retryAfterMs === 'number' && payload.retryAfterMs > 0
        ? ` (the running generation can be retried in at most ${Math.ceil(payload.retryAfterMs / 60_000)} minutes)`
        : '';
    throw new Error(`${payload?.error ?? `Generation failed (${response.status})`}${hint}`);
  }
  if (!response.body) throw new Error('Generation stream is unavailable');

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value.replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const parsed = parseEventBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (parsed) await onEvent(parsed);
        boundary = buffer.indexOf('\n\n');
      }
    }
    const trailing = parseEventBlock(buffer.trim());
    if (trailing) await onEvent(trailing);
  } finally {
    try {
      await reader.cancel();
    } catch {}
    reader.releaseLock();
  }
}
