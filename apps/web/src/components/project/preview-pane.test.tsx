// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreviewPane } from '@/components/project/preview-pane';
import type { SelectedPreviewElement } from '@/components/project/types';

const PREVIEW_URL = 'https://preview.sovereign.test';

const selectedElement: SelectedPreviewElement = {
  tagName: 'h1',
  id: null,
  className: '',
  text: 'Original title',
  selector: 'body > h1',
  sourceFile: 'index.html',
  veId: null,
  outerHTML: '<h1>Original title</h1>',
};

function renderPane(isEditMode: boolean) {
  const onQuickEdit = vi.fn();
  const view = render(
    <PreviewPane
      url={PREVIEW_URL}
      status="ready"
      logs={[]}
      error={null}
      previewKey={1}
      isEditMode={isEditMode}
      isSending={false}
      previewCursorTarget={null}
      selectedPreviewElement={null}
      onSelectedElementChange={() => {}}
      onQuickEdit={onQuickEdit}
    />,
  );
  const frame = view.container.querySelector('iframe');
  if (!frame?.contentWindow) throw new Error('preview frame was not rendered');

  const sendEditRequest = () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          source: 'sovereign-visual-editor',
          type: 'edit-request',
          element: selectedElement,
          prompt: 'Make the headline smaller',
        },
        origin: PREVIEW_URL,
        source: frame.contentWindow,
      }),
    );
  };

  return { onQuickEdit, sendEditRequest };
}

describe('PreviewPane quick edits', () => {
  it('ignores an edit request forged by the preview while edit mode is off', () => {
    const { onQuickEdit, sendEditRequest } = renderPane(false);

    sendEditRequest();

    expect(onQuickEdit).not.toHaveBeenCalled();
  });

  it('forwards an edit request while the user is in edit mode', () => {
    const { onQuickEdit, sendEditRequest } = renderPane(true);

    sendEditRequest();

    expect(onQuickEdit).toHaveBeenCalledWith(
      'Make the headline smaller',
      expect.objectContaining({ tagName: 'h1' }),
    );
  });
});
