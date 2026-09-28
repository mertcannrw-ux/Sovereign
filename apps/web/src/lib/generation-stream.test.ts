import { describe, expect, it, vi } from 'vitest';
import { consumeGenerationStream } from '@/lib/generation-stream';

describe('consumeGenerationStream', () => {
  it('parses events split across network chunks', async () => {
    const encoder = new TextEncoder();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: phase\ndata: {"phase":"plan'));
          controller.enqueue(encoder.encode('ning","label":"Planning"}\n\nevent: file-preview\n'));
          controller.enqueue(
            encoder.encode(
              'data: {"operation":"create","path":"index.html","content":"<h1>Ready</h1>","line":1,"column":13}\n\n',
            ),
          );
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
      type: 'file-preview',
      data: {
        operation: 'create',
        path: 'index.html',
        content: '<h1>Ready</h1>',
        line: 1,
        column: 13,
      },
    });
  });

  it('surfaces an API error response', async () => {
    const response = Response.json({ error: 'No API key configured' }, { status: 400 });
    await expect(consumeGenerationStream(response, vi.fn())).rejects.toThrow(
      'No API key configured',
    );
  });
  it('parses agent steps and live file operations', async () => {
    const body = [
      'event: step\ndata: {"id":"step-1","kind":"thinking","title":"Plan","detail":"Build the app","status":"complete","startedAt":"2026-01-01T00:00:00.000Z"}\n\n',
      'event: file-operation\ndata: {"operation":"create","path":"src/App.tsx","content":"export default function App() {}","versionNumber":1}\n\n',
    ].join('');
    const response = new Response(body, { status: 200 });
    const onEvent = vi.fn();

    await consumeGenerationStream(response, onEvent);

    expect(onEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'step' }));
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: 'file-operation',
      data: {
        operation: 'create',
        path: 'src/App.tsx',
        content: 'export default function App() {}',
        versionNumber: 1,
      },
    });
  });

  it('streams answer snapshots until the final message clears them', async () => {
    const response = new Response(
      [
        'event: answer\ndata: {"content":"The preview updates"}\n\n',
        'event: answer\ndata: {"content":"The preview updates after every write."}\n\n',
        'event: answer\ndata: {"content":""}\n\n',
        'event: ready\ndata: {"userMessage":{"id":"u1","role":"user","content":"hi","timestamp":"2026-01-01T00:00:00.000Z","model":null},"assistantMessage":{"id":"a1","role":"assistant","content":"The preview updates after every write.","timestamp":"2026-01-01T00:00:00.000Z","model":null,"tokenUsage":{"promptTokens":1,"completionTokens":1,"totalTokens":2}},"files":[],"versionNumber":1}\n\n',
      ].join(''),
      { status: 200 },
    );
    const onEvent = vi.fn();

    await consumeGenerationStream(response, onEvent);

    expect(onEvent).toHaveBeenNthCalledWith(1, {
      type: 'answer',
      data: { content: 'The preview updates' },
    });
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: 'answer',
      data: { content: 'The preview updates after every write.' },
    });
    // An empty snapshot is meaningful: the turn settled as a tool call, not an
    // answer, so the live bubble is cleared. It must survive the whitelist too.
    expect(onEvent).toHaveBeenNthCalledWith(3, { type: 'answer', data: { content: '' } });
    expect(onEvent).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        type: 'ready',
        data: expect.objectContaining({ versionNumber: 1 }),
      }),
    );
  });

  it('delivers provisional file content before the committed operation', async () => {
    const response = new Response(
      [
        'event: file-preview\ndata: {"operation":"create","path":"src/App.tsx","content":"export default","line":1,"column":14}\n\n',
        'event: file-operation\ndata: {"operation":"create","path":"src/App.tsx","content":"export default function App() {}","versionNumber":2}\n\n',
      ].join(''),
      { status: 200 },
    );
    const onEvent = vi.fn();

    await consumeGenerationStream(response, onEvent);

    expect(onEvent).toHaveBeenNthCalledWith(1, {
      type: 'file-preview',
      data: {
        operation: 'create',
        path: 'src/App.tsx',
        content: 'export default',
        line: 1,
        column: 14,
      },
    });
    expect(onEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'file-operation' }));
  });

  it('parses image-job and design-directions events', async () => {
    const body = [
      'event: image-job\ndata: {"id":"job-1","status":"complete","semanticUse":"hero-bg","publicUrl":"https://pub.r2.dev/test.png"}\n\n',
      'event: design-directions\ndata: {"id":"set-1","status":"ready","originalRequest":"Build a dashboard","directions":[]}\n\n',
    ].join('');
    const response = new Response(body, { status: 200 });
    const onEvent = vi.fn();

    await consumeGenerationStream(response, onEvent);

    expect(onEvent).toHaveBeenNthCalledWith(1, {
      type: 'image-job',
      data: {
        id: 'job-1',
        status: 'complete',
        semanticUse: 'hero-bg',
        publicUrl: 'https://pub.r2.dev/test.png',
      },
    });
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: 'design-directions',
      data: {
        id: 'set-1',
        status: 'ready',
        originalRequest: 'Build a dashboard',
        directions: [],
      },
    });
  });

  it('skips malformed SSE data blocks without throwing', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: file-preview\ndata: {not valid json\n\n'));
        controller.enqueue(
          encoder.encode('event: phase\ndata: {"phase":"generating","label":"Working"}\n\n'),
        );
        controller.close();
      },
    });
    const events: unknown[] = [];
    await consumeGenerationStream(new Response(stream, { status: 200 }), async (event) => {
      events.push(event);
    });
    // The malformed block is skipped; the valid block after it still fires.
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'phase',
      data: { phase: 'generating', label: 'Working' },
    });
  });
});
