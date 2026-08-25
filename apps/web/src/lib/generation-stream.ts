import type { ClarifyingQuestion, GeneratedFile } from '@/lib/generation-protocol';
import type { AgentStep } from '@/lib/agent-protocol';

export interface GenerationPhaseEvent {
  phase: 'planning' | 'generating' | 'building';
  label: string;
}

export interface FileProgressEvent extends GeneratedFile {
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
  | { type: 'file-start'; data: { path: string } }
  | { type: 'file-progress'; data: FileProgressEvent }
  | { type: 'file-complete'; data: GeneratedFile }
  | { type: 'thinking'; data: { content: string } }
  | { type: 'questions'; data: GenerationQuestionsEvent }
  | { type: 'image-job'; data: ImageJobEventData }
  | { type: 'design-directions'; data: DesignDirectionsEventData }
  | { type: 'ready'; data: GenerationReadyEvent }
  | { type: 'failed'; data: { message: string } };

function parseEventBlock(block: string): GenerationEvent | null {
  let event = '';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!event || data.length === 0) return null;

  let payload: GenerationEvent['data'];
  try {
    payload = JSON.parse(data.join('\n')) as GenerationEvent['data'];
  } catch {
    return null;
  }
  if (
    event !== 'phase' &&
    event !== 'step' &&
    event !== 'file-operation' &&
    event !== 'file-preview' &&
    event !== 'file-start' &&
    event !== 'file-progress' &&
    event !== 'file-complete' &&
    event !== 'thinking' &&
    event !== 'questions' &&
    event !== 'image-job' &&
    event !== 'design-directions' &&
    event !== 'ready' &&
    event !== 'failed'
  ) {
    return null;
  }
  return { type: event, data: payload } as GenerationEvent;
}

export async function consumeGenerationStream(
  response: Response,
  onEvent: (event: GenerationEvent) => void | Promise<void>,
): Promise<void> {
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `Generation failed (${response.status})`);
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
