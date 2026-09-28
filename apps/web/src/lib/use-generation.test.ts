// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GenerationEvent } from '@/lib/generation-stream';
import { consumeGenerationStream } from '@/lib/generation-stream';
import {
  useGeneration,
  type GenerationHistoryMessage,
  type UseGenerationOptions,
} from '@/lib/use-generation';

// The stream itself is exercised in generation-stream.test.ts; these tests drive
// the hook with hand-picked events so the run-outcome handling can be checked.
vi.mock('@/lib/generation-stream', () => ({
  consumeGenerationStream: vi.fn(),
}));

const COMMITTED_HTML = '<h1>committed</h1>';
const PARTIAL_HTML = '<h1>half writ';

/** Stands in for `usePreviewRuntime`, recording everything the hook asks it to do. */
function createPreview(): UseGenerationOptions['preview'] {
  return {
    files: new Map([['index.html', COMMITTED_HTML]]),
    applyFilePreview: vi.fn(),
    applyFileOperation: vi.fn(),
    applyFiles: vi.fn().mockResolvedValue(undefined),
    applyImmediateWrite: vi.fn().mockResolvedValue(undefined),
    flushPendingWrites: vi.fn().mockResolvedValue(undefined),
    handleRuntimeRequest: vi.fn().mockResolvedValue(undefined),
  };
}

function createOptions(preview: UseGenerationOptions['preview']): UseGenerationOptions {
  return {
    projectId: 'project-1',
    selectedModel: 'gpt-test',
    selectedProvider: 'openai',
    reasoningEffort: 'auto',
    editTarget: null,
    preview,
    history: [],
    onHistoryRefetch: vi.fn().mockResolvedValue(undefined),
    onVersionsRefetch: vi.fn().mockResolvedValue(undefined),
    onFilesRefetch: vi.fn().mockResolvedValue(undefined),
    onClearEditTarget: vi.fn(),
    onClearInput: vi.fn(),
    onRestoreInput: vi.fn(),
  };
}

/**
 * Holds the mocked stream open so a run can be inspected mid-flight: events are
 * delivered on demand and the run ends when `fail` (or nothing) is called.
 */
function driveStream() {
  let onEvent: ((event: GenerationEvent) => void | Promise<void>) | null = null;
  let failStream: ((error: unknown) => void) | null = null;
  vi.mocked(consumeGenerationStream).mockImplementation(async (_response, handler) => {
    onEvent = handler;
    await new Promise<void>((_resolve, reject) => {
      failStream = reject;
    });
  });
  return {
    emit: (event: GenerationEvent) => Promise.resolve(onEvent?.(event)),
    fail: (error: unknown) => failStream?.(error),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('useGeneration run outcomes', () => {
  it('discards streamed fragments instead of flushing them when a run is stopped', async () => {
    const preview = createPreview();
    const options = createOptions(preview);
    const stream = driveStream();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const { result } = renderHook(() => useGeneration(options));

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.send('build a landing page');
    });
    await act(async () => {
      await stream.emit({
        type: 'file-preview',
        data: { operation: 'update', path: 'index.html', content: PARTIAL_HTML },
      });
    });
    expect(preview.applyFilePreview).toHaveBeenCalledWith({
      operation: 'update',
      path: 'index.html',
      content: PARTIAL_HTML,
    });

    await act(async () => {
      result.current.stop();
      stream.fail(new DOMException('The operation was aborted.', 'AbortError'));
      await sendPromise;
    });

    // The partial fragment must never reach the sandbox: the server never
    // committed it, so flushing it is what left an unparseable file behind.
    expect(preview.flushPendingWrites).not.toHaveBeenCalled();
    // ...and the committed content is restored to the mirror + editor instead.
    expect(preview.applyFilePreview).toHaveBeenLastCalledWith({
      operation: 'update',
      path: 'index.html',
      content: COMMITTED_HTML,
    });
    expect(result.current.activeFile?.content).toBe(COMMITTED_HTML);
    // The server keeps what it committed mid-run, so the client re-reads it.
    expect(options.onFilesRefetch).toHaveBeenCalledTimes(1);
    expect(options.onVersionsRefetch).toHaveBeenCalledTimes(1);
    expect(options.onHistoryRefetch).toHaveBeenCalledTimes(1);
  });

  it('tracks the model write position from file-preview events', async () => {
    const preview = createPreview();
    const options = createOptions(preview);
    const stream = driveStream();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const { result } = renderHook(() => useGeneration(options));

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.send('build a landing page');
    });
    await act(async () => {
      await stream.emit({
        type: 'file-preview',
        data: {
          operation: 'update',
          path: 'index.html',
          content: PARTIAL_HTML,
          line: 12,
          column: 7,
        },
      });
    });
    // The AI cursor reads this state: it must reflect the streamed position.
    expect(result.current.activeFile).toEqual({
      path: 'index.html',
      content: PARTIAL_HTML,
      line: 12,
      column: 7,
    });

    // Rollback emissions restore prior content and carry no position — the
    // cursor resets to the top rather than pointing past the restored file.
    await act(async () => {
      await stream.emit({
        type: 'file-preview',
        data: { operation: 'update', path: 'index.html', content: COMMITTED_HTML },
      });
    });
    expect(result.current.activeFile).toEqual({
      path: 'index.html',
      content: COMMITTED_HTML,
      line: 1,
      column: 0,
    });

    await act(async () => {
      stream.fail(new Error('run over'));
      await sendPromise;
    });
  });

  it('rolls a provisionally created file back when a run is stopped', async () => {
    const preview = createPreview();
    const options = createOptions(preview);
    const stream = driveStream();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const { result } = renderHook(() => useGeneration(options));

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.send('add a page');
    });
    await act(async () => {
      await stream.emit({
        type: 'file-preview',
        data: { operation: 'create', path: 'about.html', content: '<h1>About' },
      });
    });

    await act(async () => {
      result.current.stop();
      stream.fail(new DOMException('The operation was aborted.', 'AbortError'));
      await sendPromise;
    });

    // The file did not exist before the run, so the rollback removes it rather
    // than leaving a truncated file in the sandbox.
    expect(preview.applyFilePreview).toHaveBeenLastCalledWith({
      operation: 'delete',
      path: 'about.html',
    });
    expect(preview.flushPendingWrites).not.toHaveBeenCalled();
  });

  it('surfaces a clean failure message and resyncs after a failed run', async () => {
    const preview = createPreview();
    const options = createOptions(preview);
    const stream = driveStream();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const { result } = renderHook(() => useGeneration(options));

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.send('build a landing page');
    });
    await act(async () => {
      await stream.emit({
        type: 'file-preview',
        data: { operation: 'update', path: 'index.html', content: PARTIAL_HTML },
      });
    });
    await act(async () => {
      stream.fail(new Error('{"error":{"message":"Incorrect API key provided: sk-secret"}}'));
      await sendPromise;
    });

    const failure = result.current.localMessages.at(-1);
    expect(failure?.content).toBe(
      'Generation failed. Check your API key and model settings, then try again.',
    );
    // The provider's raw body stays available, but out of the transcript text.
    expect(failure?.thinking).toContain('Incorrect API key provided');
    expect(
      result.current.localMessages.some((message) => message.content.includes('sk-secret')),
    ).toBe(false);
    expect(options.onRestoreInput).toHaveBeenCalledWith('build a landing page');
    // Files/versions committed before the failure must not stay stale...
    expect(options.onFilesRefetch).toHaveBeenCalledTimes(1);
    expect(options.onVersionsRefetch).toHaveBeenCalledTimes(1);
    // ...and the failed run's fragment must not be flushed either.
    expect(preview.flushPendingWrites).not.toHaveBeenCalled();
    expect(result.current.isSending).toBe(false);
  });

  it('keeps the failure message when the history refetch lands', async () => {
    const preview = createPreview();
    const options = createOptions(preview);
    const stream = driveStream();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const { result, rerender } = renderHook(
      ({ history }: { history: GenerationHistoryMessage[] }) =>
        useGeneration({ ...options, history }),
      { initialProps: { history: [] as GenerationHistoryMessage[] } },
    );

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.send('build a landing page');
    });
    await act(async () => {
      stream.fail(new Error('provider exploded'));
      await sendPromise;
    });

    // The server persisted the user message but not the failure, so the refetch
    // must not wipe the notice the user needs to see.
    await act(async () => {
      rerender({
        history: [
          {
            id: 'server-user-1',
            role: 'user',
            content: 'build a landing page',
            timestamp: new Date().toISOString(),
            model: 'openai:gpt-test',
          },
        ],
      });
    });

    expect(result.current.localMessages.map((message) => message.content)).toEqual([
      'build a landing page',
      'Generation failed. Check your API key and model settings, then try again.',
    ]);
  });

  it('ignores a second send issued while a run is still in flight', async () => {
    const preview = createPreview();
    const options = createOptions(preview);
    const stream = driveStream();
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { result } = renderHook(() => useGeneration(options));

    let firstSend: Promise<void> | undefined;
    await act(async () => {
      // Same tick: the `isSending` state has not re-rendered yet, so only the
      // in-flight flag can reject the duplicate.
      firstSend = result.current.send('first prompt');
      void result.current.send('second prompt');
    });

    expect(vi.mocked(consumeGenerationStream)).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      stream.fail(new DOMException('The operation was aborted.', 'AbortError'));
      await firstSend;
    });
  });

  it('flushes buffered writes when the run completes normally', async () => {
    const preview = createPreview();
    const options = createOptions(preview);
    vi.mocked(consumeGenerationStream).mockImplementation(async (_response, handler) => {
      await handler({
        type: 'ready',
        data: {
          userMessage: {
            id: 'user-1',
            role: 'user',
            content: 'hi',
            timestamp: new Date().toISOString(),
            model: 'openai:gpt-test',
          },
          assistantMessage: {
            id: 'assistant-1',
            role: 'assistant',
            content: 'done',
            timestamp: new Date().toISOString(),
            model: 'openai:gpt-test',
            tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          },
          files: [{ path: 'index.html', content: '<h1>new</h1>' }],
          versionNumber: 2,
        },
      });
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const { result } = renderHook(() => useGeneration(options));

    await act(async () => {
      await result.current.send('build a landing page');
    });

    expect(preview.applyFiles).toHaveBeenCalledWith([
      { path: 'index.html', content: '<h1>new</h1>' },
    ]);
    expect(preview.flushPendingWrites).toHaveBeenCalledTimes(1);
    expect(result.current.currentVersion).toBe(2);
  });

  it('tracks the streamed answer and drops it once the run settles', async () => {
    const preview = createPreview();
    const options = createOptions(preview);
    const stream = driveStream();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const { result } = renderHook(() => useGeneration(options));

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.send('does the preview update?');
    });
    expect(result.current.liveAnswer).toBe('');

    await act(async () => {
      await stream.emit({ type: 'answer', data: { content: 'Yes — after every' } });
    });
    expect(result.current.liveAnswer).toBe('Yes — after every');

    await act(async () => {
      await stream.emit({ type: 'answer', data: { content: 'Yes — after every write.' } });
    });
    expect(result.current.liveAnswer).toBe('Yes — after every write.');

    // A tool turn settles with no answer at all: the prose prefix must not be
    // left on screen pretending to be the reply.
    await act(async () => {
      await stream.emit({ type: 'answer', data: { content: '' } });
    });
    expect(result.current.liveAnswer).toBe('');

    await act(async () => {
      stream.fail(new Error('run over'));
      await sendPromise;
    });
    expect(result.current.liveAnswer).toBe('');
  });
});
