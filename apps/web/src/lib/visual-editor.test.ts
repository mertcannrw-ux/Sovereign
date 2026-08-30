// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AXE_RUNTIME_SCRIPT,
  AXE_SCRIPT_PATH,
  EDITOR_SCRIPT_PATH,
  VISUAL_EDITOR_SCRIPT,
  instrumentPreviewHtml,
} from '@/lib/visual-editor';

describe('visual editor', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body><main><h1>Original title</h1></main></body>';
  });

  it('instruments generated HTML exactly once', () => {
    const original = '<!doctype html><html><body><main>App</main></body></html>';
    const instrumented = instrumentPreviewHtml(original);

    expect(instrumented).toContain(`<script src="${EDITOR_SCRIPT_PATH}"></script>`);
    expect(instrumented).toContain(`<script src="${AXE_SCRIPT_PATH}"></script></body>`);
    expect(instrumentPreviewHtml(instrumented)).toBe(instrumented);
  });

  it('adds the missing axe tag when the editor script is already present', () => {
    const html = `<!doctype html><html><body><main>App</main><script src="${EDITOR_SCRIPT_PATH}"></script></body></html>`;
    const instrumented = instrumentPreviewHtml(html);
    expect(instrumented).toContain(`<script src="${AXE_SCRIPT_PATH}"></script></body>`);
    expect(instrumented.match(new RegExp(EDITOR_SCRIPT_PATH, 'g'))).toHaveLength(1);
  });

  it('selects an element and sends a scoped inline edit request', () => {
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    Function(VISUAL_EDITOR_SCRIPT)();
    window.dispatchEvent(new MessageEvent('message', {
      data: { source: 'sovereign-visual-editor', type: 'set-edit-mode', enabled: true },
    }));

    const heading = document.querySelector('h1');
    heading?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const editor = document.querySelector('#sovereign-editor-ui');
    const input = editor?.querySelector('textarea') as HTMLTextAreaElement;
    const send = editor?.querySelector('[aria-label="Send element edit"]') as HTMLButtonElement;
    expect(heading).toHaveAttribute('data-sovereign-selected');
    expect(editor).toHaveAttribute('data-open');
    expect(editor?.querySelector('.sv-label')).toHaveTextContent('h1');

    input.value = 'Make this headline smaller';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    send.click();

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      source: 'sovereign-visual-editor',
      type: 'edit-request',
      prompt: 'Make this headline smaller',
      element: expect.objectContaining({
        tagName: 'h1',
        outerHTML: '<h1>Original title</h1>',
        selector: 'body > main > h1',
        sourceFile: 'index.html',
        text: 'Original title',
      }),
    }), window.location.origin);
    postMessage.mockRestore();
  });

  it('posts empty axe violations when axe-core is not loaded', () => {
    vi.useFakeTimers();
    const idle = window.requestIdleCallback;
    // Force the timeout path so fake timers control scheduling.
    // @ts-expect-error test stub
    delete window.requestIdleCallback;
    const postMessage = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    Function(AXE_RUNTIME_SCRIPT)();
    window.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(1500);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'sovereign-a11y', type: 'violations', violations: [] }),
      window.location.origin,
    );
    postMessage.mockRestore();
    if (idle) window.requestIdleCallback = idle;
    vi.useRealTimers();
  });
});
