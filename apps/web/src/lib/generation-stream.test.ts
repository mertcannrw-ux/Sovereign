import { describe, expect, it, vi } from 'vitest';
import { consumeGenerationStream } from '@/lib/generation-stream';

describe('consumeGenerationStream', () => {
  it('parses events split across network chunks', async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: phase\ndata: {"phase":"plan'));
          controller.enqueue(encoder.encode('ning","label":"Planning"}\n\nevent: file-start\n'));
          controller.enqueue(encoder.encode('data: {"path":"index.html"}\n\nevent: file-complete\ndata: {"path":"index.html","content":"<h1>Ready</h1>"}\n\n'));
          controller.close();
        },
      }),
      { status: 200 },
    );
    const onEvent = vi.fn();

    await consumeGenerationStream(response, onEvent);

    expect(onEvent).toHaveBeenNthCalledWith(1, {
      type: 'phase',
      data: { phase: 'planning', label: 'Planning' },
    });
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: 'file-start',
      data: { path: 'index.html' },
    });
    expect(onEvent).toHaveBeenNthCalledWith(3, {
      type: 'file-complete',
      data: { path: 'index.html', content: '<h1>Ready</h1>' },
    });
  });

  it('surfaces an API error response', async () => {
    const response = Response.json({ error: 'No API key configured' }, { status: 400 });
    await expect(consumeGenerationStream(response, vi.fn())).rejects.toThrow(
      'No API key configured',
    );
  });
});
