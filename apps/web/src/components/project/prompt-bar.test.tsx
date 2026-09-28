// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PromptBar, type PromptBarProps } from '@/components/project/prompt-bar';

const FILE_NAME = 'notes.txt';
const FILE_CONTENT = 'hello from notes';

function createProps(overrides: Partial<PromptBarProps> = {}): PromptBarProps {
  return {
    input: 'build a landing page',
    onInputChange: vi.fn(),
    inputRef: { current: null },
    isSending: false,
    selectedModelKey: 'openai:gpt-test',
    selectedModel: 'gpt-test',
    selectedProvider: 'openai',
    onSelectModelKey: vi.fn(),
    reasoningEffort: 'auto',
    onReasoningEffortChange: vi.fn(),
    availableModels: [],
    selectedPreviewElement: null,
    onClearSelectedElement: vi.fn(),
    clarifyingLocked: false,
    onSend: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };
}

/** Attaches one readable text file through the hidden file input. */
async function attachFile(container: HTMLElement) {
  const fileInput = container.querySelector('input[type="file"]');
  if (!fileInput) throw new Error('file input was not rendered');
  const file = new File([FILE_CONTENT], FILE_NAME, { type: 'text/plain' });
  Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
  fireEvent.change(fileInput);
  await waitFor(() => expect(screen.getByText(FILE_NAME)).toBeInTheDocument());
}

function pressEnter() {
  fireEvent.keyDown(screen.getByLabelText('Message the agent'), { key: 'Enter' });
}

describe('PromptBar send handling', () => {
  it('keeps the attachments and explains why when a send is rejected', async () => {
    const props = createProps({ isSending: true });
    const { container } = render(<PromptBar {...props} />);
    await attachFile(container);

    pressEnter();

    expect(props.onSend).not.toHaveBeenCalled();
    expect(screen.getByText(FILE_NAME)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Wait for the current response to finish before sending.',
    );
  });

  it('sends the attachments and clears the composer when the send is accepted', async () => {
    const onSend = vi.fn();
    const props = createProps({ onSend });
    const { container } = render(<PromptBar {...props} />);
    await attachFile(container);

    pressEnter();

    expect(onSend).toHaveBeenCalledWith('build a landing page', [
      { path: FILE_NAME, content: FILE_CONTENT },
    ]);
    expect(screen.queryByText(FILE_NAME)).not.toBeInTheDocument();
  });

  it('restores the attachments when the caller reports the send was rejected', async () => {
    const onSend = vi.fn().mockResolvedValue(false);
    const props = createProps({ onSend });
    const { container } = render(<PromptBar {...props} />);
    await attachFile(container);

    pressEnter();

    await waitFor(() => expect(screen.getByText(FILE_NAME)).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('Your attachments were kept');
  });
});

describe('PromptBar model panel dismissal', () => {
  const PANEL_NAME = 'Model and reasoning settings';

  function openPanel() {
    fireEvent.click(screen.getByRole('button', { name: /gpt-test/ }));
    return screen.getByRole('dialog', { name: PANEL_NAME });
  }

  it('dismisses the panel when the press lands outside of it without stealing focus', () => {
    render(<PromptBar {...createProps()} />);
    openPanel();
    const textarea = screen.getByLabelText('Message the agent');
    textarea.focus();

    fireEvent.pointerDown(textarea);

    expect(screen.queryByRole('dialog', { name: PANEL_NAME })).not.toBeInTheDocument();
    expect(textarea).toHaveFocus();
  });

  it('keeps the panel open when the press lands inside of it', () => {
    render(<PromptBar {...createProps()} />);
    openPanel();

    fireEvent.pointerDown(screen.getByText('Effort'));

    expect(screen.getByRole('dialog', { name: PANEL_NAME })).toBeInTheDocument();
  });

  it('still lets the trigger toggle the panel shut', () => {
    render(<PromptBar {...createProps()} />);
    openPanel();
    const trigger = screen.getByRole('button', { name: /gpt-test/ });

    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);

    expect(screen.queryByRole('dialog', { name: PANEL_NAME })).not.toBeInTheDocument();
  });

  it('dismisses the panel when focus moves out of the window, such as into the preview iframe', () => {
    render(<PromptBar {...createProps()} />);
    openPanel();

    fireEvent.blur(window);

    expect(screen.queryByRole('dialog', { name: PANEL_NAME })).not.toBeInTheDocument();
  });
});
