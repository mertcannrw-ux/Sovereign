import { AIProvider } from '@app-builder/shared';
import type { GenerateBody, GeneratePayloadValidation } from './types';

export const MAX_ATTACHMENT_BYTES = 512 * 1024;
export const MAX_SINGLE_ATTACHMENT_BYTES = 100 * 1024;
export const MAX_ATTACHMENT_COUNT = 10;

export function parseProvider(value: string): AIProvider {
  const parsed = AIProvider.safeParse(value);
  if (!parsed.success) throw new Error(`Unsupported AI provider: ${value}`);
  return parsed.data;
}

export function validateGeneratePayload(body: unknown): GeneratePayloadValidation {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Invalid JSON body' };
  }

  const candidate = body as GenerateBody;
  const projectId = candidate.projectId?.trim();

  if (
    candidate.directionResponse &&
    (!projectId || !candidate.modelProvider || !candidate.modelName)
  ) {
    return {
      ok: false,
      error: 'Missing generation input for direction response',
    };
  }

  const prompt = candidate.message?.trim();
  if (
    !projectId ||
    (!prompt && !candidate.directionResponse) ||
    !candidate.modelProvider ||
    !candidate.modelName
  ) {
    return { ok: false, error: 'Missing generation input' };
  }

  try {
    parseProvider(candidate.modelProvider);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid provider',
    };
  }

  let attachmentBytes = 0;
  const filesList = Array.isArray(candidate.files)
    ? candidate.files.slice(0, MAX_ATTACHMENT_COUNT)
    : [];

  for (const file of filesList) {
    const path = (file?.path ?? '').trim().slice(0, 256);
    const content = file?.content ?? '';
    if (!path || !content) continue;
    const contentBytes = Buffer.byteLength(content, 'utf8');
    if (contentBytes > MAX_SINGLE_ATTACHMENT_BYTES) continue;
    attachmentBytes += contentBytes;
  }

  if (attachmentBytes > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: 'Attachments exceed 512 KB total' };
  }

  return { ok: true, data: candidate };
}
