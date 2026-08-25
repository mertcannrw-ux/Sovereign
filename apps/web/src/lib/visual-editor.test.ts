// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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

    expect(instrumented).toContain(`<script src="${EDITOR_SCRIPT_PATH}"></script></body>`);
    expect(instrumentPreviewHtml(instrumented)).toBe(instrumented);
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
    }), '*');
    postMessage.mockRestore();
  });
});
