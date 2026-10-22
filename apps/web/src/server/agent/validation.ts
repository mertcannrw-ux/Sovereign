import { AIProvider } from '@app-builder/shared';
import type { GenerateBody, GeneratePayloadValidation } from './types';

export const MAX_ATTACHMENT_BYTES = 512 * 1024;
export const MAX_SINGLE_ATTACHMENT_BYTES = 100 * 1024;
export const MAX_ATTACHMENT_COUNT = 10;
/** Longest accepted user prompt; well above any real instruction, well below a payload bomb. */
export const MAX_MESSAGE_CHARS = 32_000;
export const MAX_RUNTIME_ERRORS = 20;
export const MAX_RUNTIME_ERROR_CHARS = 4_000;
export const MAX_EDIT_TARGET_HTML = 8_000;

export function parseProvider(value: string): AIProvider {
  const parsed = AIProvider.safeParse(value);
  if (!parsed.success) throw new Error(`Unsupported AI provider: ${value}`);
  return parsed.data;
}

export function validateGeneratePayload(body: unknown): GeneratePayloadValidation {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Invalid JSON body' };
  }

  const candidate = body as Record<string, unknown>;
  const stringField = (value: unknown, max: number): string | undefined =>
    typeof value === 'string' && value.length <= max ? value : undefined;

  const projectId = stringField(candidate.projectId, 100)?.trim();
  const message = stringField(candidate.message, MAX_MESSAGE_CHARS);
  const modelProvider = stringField(candidate.modelProvider, 64);
  const modelName = stringField(candidate.modelName, 200);
  if (candidate.message !== undefined && message === undefined) {
    return { ok: false, error: `Message must be a string of at most ${MAX_MESSAGE_CHARS} characters` };
  }

  const directionResponse = candidate.directionResponse;
  const hasDirection =
    directionResponse !== undefined &&
    directionResponse !== null &&
    typeof directionResponse === 'object';
  if (hasDirection) {
    const direction = directionResponse as Record<string, unknown>;
    if (
      !['select', 'skip', 'regenerate'].includes(String(direction.action)) ||
      typeof direction.setId !== 'string' ||
      direction.setId.length > 100 ||
      (direction.directionId !== undefined &&
        (typeof direction.directionId !== 'string' || direction.directionId.length > 100))
    ) {
      return { ok: false, error: 'Invalid direction response' };
    }
  }

  if (hasDirection && (!projectId || !modelProvider || !modelName)) {
    return { ok: false, error: 'Missing generation input for direction response' };
  }

  if (!projectId || (!message?.trim() && !hasDirection) || !modelProvider || !modelName) {
    return { ok: false, error: 'Missing generation input' };
  }

  try {
    parseProvider(modelProvider);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid provider',
    };
  }

  const rawFiles = candidate.files;
  const files: { path?: string; content?: string }[] = [];
  if (rawFiles !== undefined) {
    if (!Array.isArray(rawFiles)) return { ok: false, error: 'Invalid attachments' };
    for (const file of rawFiles.slice(0, MAX_ATTACHMENT_COUNT)) {
      if (!file || typeof file !== 'object') {
        return { ok: false, error: 'Invalid attachments' };
      }
      const entry = file as Record<string, unknown>;
      if (
        (entry.path !== undefined && typeof entry.path !== 'string') ||
        (entry.content !== undefined && typeof entry.content !== 'string')
      ) {
        return { ok: false, error: 'Invalid attachments' };
      }
      files.push({
        path: typeof entry.path === 'string' ? entry.path : undefined,
        content: typeof entry.content === 'string' ? entry.content : undefined,
      });
    }
  }

  let attachmentBytes = 0;
  for (const file of files) {
    const path = (file.path ?? '').trim().slice(0, 256);
    const content = file.content ?? '';
    if (!path || !content) continue;
    const contentBytes = Buffer.byteLength(content, 'utf8');
    if (contentBytes > MAX_SINGLE_ATTACHMENT_BYTES) continue;
    attachmentBytes += contentBytes;
  }
  if (attachmentBytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: 'Attachments exceed 512 KB total' };
  }

  const rawErrors = candidate.runtimeErrors;
  const runtimeErrors = Array.isArray(rawErrors)
    ? rawErrors
        .filter((entry): entry is string => typeof entry === 'string')
        .slice(0, MAX_RUNTIME_ERRORS)
        .map((entry) => entry.slice(0, MAX_RUNTIME_ERROR_CHARS))
    : undefined;

  let editTarget: GenerateBody['editTarget'];
  if (candidate.editTarget !== undefined && candidate.editTarget !== null) {
    if (typeof candidate.editTarget !== 'object') {
      return { ok: false, error: 'Invalid edit target' };
    }
    const target = candidate.editTarget as Record<string, unknown>;
    editTarget = {
      sourceFile: stringField(target.sourceFile, 300),
      tagName: stringField(target.tagName, 40),
      selector: stringField(target.selector, 500),
      outerHTML: stringField(target.outerHTML, MAX_EDIT_TARGET_HTML),
    };
  }

  return {
    ok: true,
    data: {
      projectId,
      message,
      modelProvider,
      modelName,
      // Rebuilt from scratch below, so every field the runner reads must be
      // copied here explicitly; an omission is silent because they are optional.
      reasoningEffort: stringField(candidate.reasoningEffort, 40),
      files,
      runtimeErrors,
      editTarget,
      directionResponse: hasDirection
        ? (directionResponse as GenerateBody['directionResponse'])
        : undefined,
    },
  };
}
