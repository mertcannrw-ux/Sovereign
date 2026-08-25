import { z } from 'zod';
import { ProviderError } from './types';
import { ssrfFetch } from './provider';
import { validateOutboundUrl, SsrfError } from './ssrf';

export interface GenerateImageOptions {
  baseUrl?: string;
  size?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}


export interface GenerateImageResult {
  bytes: Uint8Array;
  mediaType: string;
  revisedPrompt?: string;
}

const MAX_IMAGE_RESPONSE_BYTES = 25 * 1024 * 1024; // 25 MB

const ImageResponseDataItemSchema = z.object({
  b64_json: z.string().optional(),
  url: z.string().optional(),
  revised_prompt: z.string().optional(),
});

const ImageResponseSchema = z.object({
  data: z.array(ImageResponseDataItemSchema).min(1),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    message: z.string().optional(),
    code: z.string().optional(),
  }).optional(),
});

export function normalizeImageEndpoint(baseUrl?: string): string {
  let base = (baseUrl || 'https://api.openai.com/v1').trim();
  base = base.replace(/\/+$/, '');
  if (base.endsWith('/images/generations')) {
    base = base.slice(0, -'/images/generations'.length).replace(/\/+$/, '');
  }
  return `${base}/images/generations`;
}

function detectMediaType(bytes: Uint8Array, fallbackHeader?: string): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif';
  }
  if (fallbackHeader && fallbackHeader.startsWith('image/')) {
    return fallbackHeader.split(';')[0]!.trim();
  }
  return 'image/png';
}

export async function generateImage(
  model: string,
  prompt: string,
  apiKey: string,
  options?: GenerateImageOptions,
): Promise<GenerateImageResult> {
  const endpoint = normalizeImageEndpoint(options?.baseUrl);

  let response: Response;
  try {
    response = await ssrfFetch(
      'openai',
      endpoint,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          prompt,
          n: 1,
          size: options?.size ?? '1024x1024',
          response_format: 'b64_json',
        }),
      },
      {
        validateUrl: true,
        timeout: options?.timeoutMs ?? 60_000,
        signal: options?.signal,
      },
    );
  } catch (err) {
    if (err instanceof ProviderError) {
      throw err;
    }
    if (err instanceof SsrfError) {
      throw new ProviderError('openai', 0, 'ssrf_blocked', err.message);
    }
    throw new ProviderError(
      'openai',
      0,
      'network_error',
      err instanceof Error ? err.message : 'Failed to connect to image endpoint',
    );
  }

  if (!response.ok) {
    let errorMessage = `Upstream error ${response.status}`;
    let errorCode = 'upstream_error';
    try {
      const reader = response.body?.getReader();
      if (reader) {
        let errText = '';
        const decoder = new TextDecoder();
        while (errText.length < 65536) {
          const { done, value } = await reader.read();
          if (done) break;
          errText += decoder.decode(value, { stream: true });
        }
        reader.cancel().catch(() => {});
        const parsed: unknown = JSON.parse(errText);
        const errorResult = ErrorResponseSchema.safeParse(parsed);
        if (errorResult.success && errorResult.data.error) {
          if (errorResult.data.error.message) errorMessage = errorResult.data.error.message;
          if (errorResult.data.error.code) errorCode = errorResult.data.error.code;
        }
      }
    } catch {
      // Keep default error message
    }
    throw new ProviderError('openai', response.status, errorCode, errorMessage);
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_RESPONSE_BYTES) {
    throw new ProviderError('openai', 413, 'response_too_large', 'Image response payload exceeded size limit');
  }

  const rawText = await response.text();
  if (rawText.length > MAX_IMAGE_RESPONSE_BYTES) {
    throw new ProviderError('openai', 413, 'response_too_large', 'Image response payload exceeded size limit');
  }

  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new ProviderError('openai', 500, 'invalid_json', 'Failed to parse image response JSON');
  }

  const parseResult = ImageResponseSchema.safeParse(json);
  if (!parseResult.success) {
    throw new ProviderError('openai', 500, 'invalid_response', 'Image response structure is invalid');
  }

  const item = parseResult.data.data[0]!;
  const revisedPrompt = item.revised_prompt;

  // 1. Try b64_json
  if (item.b64_json && item.b64_json.length > 0) {
    const buffer = Buffer.from(item.b64_json, 'base64');
    const bytes = new Uint8Array(buffer);
    if (bytes.length === 0) {
      throw new ProviderError('openai', 500, 'invalid_response', 'Base64 image data is empty');
    }
    const mediaType = detectMediaType(bytes);
    return { bytes, mediaType, revisedPrompt };
  }

  // 2. Try URL fallback with SSRF protection
  if (item.url && item.url.length > 0) {
    const imageUrl = item.url;
    try {
      await validateOutboundUrl(imageUrl);
    } catch (e) {
      throw new ProviderError(
        'openai',
        0,
        'ssrf_blocked',
        `Image download URL blocked by SSRF: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const imgResponse = await ssrfFetch(
      'openai',
      imageUrl,
      {},
      {
        validateUrl: true,
        timeout: 30_000,
        signal: options?.signal,
      },
    );

    if (!imgResponse.ok) {
      throw new ProviderError(
        'openai',
        imgResponse.status,
        'download_failed',
        `Failed to download generated image from URL (${imgResponse.status})`,
      );
    }

    // F-19: header pre-check before buffering
    const dlContentLength = Number(imgResponse.headers.get('content-length'));
    if (Number.isFinite(dlContentLength) && dlContentLength > MAX_IMAGE_RESPONSE_BYTES) {
      throw new ProviderError('openai', 413, 'response_too_large', 'Downloaded image exceeded size limit');
    }

    const arrayBuffer = await imgResponse.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.length > MAX_IMAGE_RESPONSE_BYTES) {
      throw new ProviderError('openai', 413, 'response_too_large', 'Downloaded image exceeded size limit');
    }
    const contentTypeHeader = imgResponse.headers.get('content-type') ?? undefined;
    const mediaType = detectMediaType(bytes, contentTypeHeader);
    return { bytes, mediaType, revisedPrompt };
  }

  throw new ProviderError('openai', 500, 'invalid_response', 'Image response contains neither b64_json nor url');
}
