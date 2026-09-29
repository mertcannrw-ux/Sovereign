import { describe, expect, it } from 'vitest';
import {
  applyAgentEdit,
  cursorPositionAt,
  getAgentFileMutationPaths,
  getDesignDirectionActionError,
  getSettledAnswer,
  getStreamingAnswer,
  getStreamingFileAction,
  getStreamingThought,
  isSafeAgentPath,
  parseAgentAction,
} from '@/lib/agent-protocol';

describe('agent protocol', () => {
  it('parses a run action and rejects empty commands', () => {
    expect(parseAgentAction(JSON.stringify({ type: 'run', command: 'npx tsc --noEmit' }))).toEqual({
      type: 'run',
      command: 'npx tsc --noEmit',
    });
    expect(() => parseAgentAction(JSON.stringify({ type: 'run', command: '   ' }))).toThrow(
      'Run action requires a command',
    );
    expect(() =>
      parseAgentAction(JSON.stringify({ type: 'run', command: 'x'.repeat(200) })),
    ).toThrow('Run action requires a command');
  });

  it('does not report run actions as filesystem mutations or transcript answers', () => {
    expect(getAgentFileMutationPaths({ type: 'run', command: 'npm install' })).toEqual(new Set());
    expect(getSettledAnswer({ type: 'run', command: 'npm install' })).toBeNull();
  });

  it('strips embedded run JSON from a conversational reply', () => {
    expect(
      parseAgentAction(
        JSON.stringify({
          type: 'respond',
          message: 'Done. {"type":"run","command":"npx vite build"}',
        }),
      ),
    ).toEqual({ type: 'respond', message: 'Done.' });
  });

  it('parses one planned action', () => {
    expect(
      parseAgentAction(
        JSON.stringify({
          type: 'think',
          summary: 'Plan the application',
          content: 'Inspect the existing entry point, then build the requested React experience.',
        }),
      ),
    ).toEqual({
      type: 'think',
      summary: 'Plan the application',
      content: 'Inspect the existing entry point, then build the requested React experience.',
    });
  });

  it('preserves complete write contents', () => {
    expect(
      parseAgentAction(
        JSON.stringify({
          type: 'write_file',
          path: 'src/App.tsx',
          content: 'export default function App() { return <main />; }',
        }),
      ),
    ).toEqual({
      type: 'write_file',
      path: 'src/App.tsx',
      content: 'export default function App() { return <main />; }',
    });
  });

  it('rejects filesystem escape paths', () => {
    expect(isSafeAgentPath('src/App.tsx')).toBe(true);
    expect(isSafeAgentPath('../secret.txt')).toBe(false);
    expect(isSafeAgentPath('/etc/passwd')).toBe(false);
    expect(() => parseAgentAction('{"type":"delete_file","path":"../secret.txt"}')).toThrow(
      'invalid',
    );
  });

  it('requires an edit search to match exactly once', () => {
    expect(applyAgentEdit('before unique after', 'unique', 'changed')).toBe('before changed after');
    expect(() => applyAgentEdit('same same', 'same', 'changed')).toThrow('found 2');
    expect(() => applyAgentEdit('missing', 'other', 'changed')).toThrow('found 0');
  });

  it('maps streamed fragment offsets to 1-indexed line and 0-indexed column', () => {
    // Start of the file is line 1, column 0.
    expect(cursorPositionAt('<h1>Ready</h1>', 0)).toEqual({ line: 1, column: 0 });
    // End of streamed content marks where the model stopped writing.
    expect(cursorPositionAt('a\nb\nc', 5)).toEqual({ line: 3, column: 1 });
    // A streamed fragment ending at a newline lands on the next line's start.
    expect(cursorPositionAt('a\nb\nc', 4)).toEqual({ line: 3, column: 0 });
    // The newline character itself sits at the end of the line it terminates.
    expect(cursorPositionAt('a\nb\nc', 3)).toEqual({ line: 2, column: 1 });
    // Out-of-range indexes clamp to the end of the file.
    expect(cursorPositionAt('ab', 99)).toEqual({ line: 1, column: 2 });
    expect(cursorPositionAt('ab', -1)).toEqual({ line: 1, column: 0 });
  });

  it('accepts exactly three useful clarification options', () => {
    expect(
      parseAgentAction(
        JSON.stringify({
          type: 'ask_questions',
          questions: [
            { question: 'Which audience?', options: ['Consumers', 'Teams', 'Enterprises'] },
          ],
        }),
      ),
    ).toEqual({
      type: 'ask_questions',
      questions: [{ question: 'Which audience?', options: ['Consumers', 'Teams', 'Enterprises'] }],
    });
  });

  it('treats normal text as a direct conversational reply', () => {
    expect(parseAgentAction('Yes — the preview updates after every completed file write.')).toEqual(
      {
        type: 'respond',
        message: 'Yes — the preview updates after every completed file write.',
      },
    );
  });

  it('rejects malformed file actions instead of leaking them into chat', () => {
    expect(() =>
      parseAgentAction(
        'I will update it now.\n{"type":"edit_file","path":"src/App.tsx","search":"old","replace":"new"',
      ),
    ).toThrow();
  });

  it('reports the mutation path for one parsed filesystem action', () => {
    const action = parseAgentAction(
      '{"type":"edit_file","path":"src/App.tsx","search":"old","replace":"new"}',
    );
    expect([...getAgentFileMutationPaths(action)]).toEqual(['src/App.tsx']);
  });

  it('parses an explicit conversational response action', () => {
    expect(
      parseAgentAction('{"type":"respond","message":"What would you like to adjust?"}'),
    ).toEqual({
      type: 'respond',
      message: 'What would you like to adjust?',
    });
  });

  it('decodes partial thinking content while JSON is still streaming', () => {
    expect(
      getStreamingThought(
        '{"type":"think","summary":"Planning","content":"Inspect the app\\nThen build',
      ),
    ).toBe('Inspect the app\nThen build');
    expect(
      getStreamingThought('{"type":"write_file","path":"src/App.tsx","content":"secret source'),
    ).toBeNull();
  });

  it('streams the answer text of a respond/finish action while it is written', () => {
    expect(getStreamingAnswer('{"type":"respond","message":"The preview updates')).toBe(
      'The preview updates',
    );
    expect(getStreamingAnswer('{"type":"respond","message":"Line one\\nLine two')).toBe(
      'Line one\nLine two',
    );
    expect(getStreamingAnswer('{"type":"finish","summary":"Added the about page')).toBe(
      'Added the about page',
    );
    // The field has not started yet, and the closing quote ends the snapshot.
    expect(getStreamingAnswer('{"type":"respond",')).toBeNull();
    expect(getStreamingAnswer('{"type":"respond","message":"Done."}')).toBe('Done.');
  });

  it('streams plain prose as the answer but never a tool payload or a build plan', () => {
    expect(getStreamingAnswer('Yes — the preview updates after every completed file')).toBe(
      'Yes — the preview updates after every completed file',
    );
    // Tool calls and thinking are not answers; the tolerated prose prefix in
    // front of a tool action stops streaming the moment the action appears.
    expect(
      getStreamingAnswer('{"type":"write_file","path":"src/App.tsx","content":"export default'),
    ).toBeNull();
    expect(getStreamingAnswer('{"type":"think","content":"Inspect the entry point')).toBeNull();
    expect(
      getStreamingAnswer('I will build it now.\n{"type":"write_file","path":"index.html"'),
    ).toBeNull();
    expect(getStreamingAnswer('   ')).toBeNull();
  });

  it('settles an action into the text the run will persist', () => {
    expect(getSettledAnswer(parseAgentAction('{"type":"respond","message":"All set."}'))).toBe(
      'All set.',
    );
    expect(
      getSettledAnswer(parseAgentAction('{"type":"finish","summary":"Added two pages"}')),
    ).toBe('Added two pages');
    // `respond` wins over `finish` inside one batch, exactly as the route does.
    expect(
      getSettledAnswer(
        parseAgentAction(
          '[{"type":"finish","summary":"summary"},{"type":"respond","message":"message"}]',
        ),
      ),
    ).toBe('message');
    expect(
      getSettledAnswer(parseAgentAction('{"type":"delete_file","path":"old.css"}')),
    ).toBeNull();
  });

  it('extracts multiple tool actions after prose without leaking them as chat', () => {
    const action = parseAgentAction(
      `I'll add the remaining files now.\n\n{"type":"write_file","path":"index.html","content":"<main></main>"}\n\n{"type":"write_file","path":"src/main.tsx","content":"render();"}`,
    );
    expect(action).toEqual({
      type: 'batch',
      actions: [
        { type: 'write_file', path: 'index.html', content: '<main></main>' },
        { type: 'write_file', path: 'src/main.tsx', content: 'render();' },
      ],
    });
  });

  it('accepts a JSON array of tool actions', () => {
    expect(
      parseAgentAction(
        '[{"type":"delete_file","path":"old.css"},{"type":"read_files","files":[{"path":"src/App.tsx","startLine":120,"endLine":220}]}]',
      ),
    ).toEqual({
      type: 'batch',
      actions: [
        { type: 'delete_file', path: 'old.css' },
        { type: 'read_files', files: [{ path: 'src/App.tsx', startLine: 120, endLine: 220 }] },
      ],
    });
  });

  it('supports full reads and open-ended line ranges', () => {
    expect(
      parseAgentAction(
        '{"type":"read_files","files":[{"path":"src/App.tsx"},{"path":"src/index.css","startLine":80},{"path":"package.json","endLine":12}]}',
      ),
    ).toEqual({
      type: 'read_files',
      files: [
        { path: 'src/App.tsx' },
        { path: 'src/index.css', startLine: 80 },
        { path: 'package.json', endLine: 12 },
      ],
    });
  });

  it('rejects reversed or non-positive read ranges', () => {
    expect(() =>
      parseAgentAction(
        '{"type":"read_files","files":[{"path":"src/App.tsx","startLine":20,"endLine":10}]}',
      ),
    ).toThrow('reversed line range');
    expect(() =>
      parseAgentAction('{"type":"read_files","files":[{"path":"src/App.tsx","startLine":0}]}'),
    ).toThrow('invalid line bounds');
  });

  it('accepts underspecified thinking actions without failing the run', () => {
    expect(
      parseAgentAction('{"type":"think","content":"I should inspect the current page."}'),
    ).toEqual({
      type: 'think',
      summary: 'I should inspect the current page.',
      content: 'I should inspect the current page.',
    });
    expect(parseAgentAction('{"type":"think","summary":"Planning"}')).toEqual({
      type: 'think',
      summary: 'Planning',
      content: 'Planning',
    });
  });

  it('decodes provisional write contents before the JSON action completes', () => {
    expect(
      getStreamingFileAction(
        '{"type": "write_file", "path": "src/App.tsx", "content": "line one\\nline two',
      ),
    ).toEqual({
      type: 'write_file',
      path: 'src/App.tsx',
      content: 'line one\nline two',
    });
  });

  it('builds provisional edits only after the exact search text is complete', () => {
    expect(
      getStreamingFileAction(
        '{"type":"edit_file","path":"src/App.tsx","search":"old","replace":"new',
      ),
    ).toEqual({
      type: 'edit_file',
      path: 'src/App.tsx',
      search: 'old',
      replace: 'new',
    });
    expect(
      getStreamingFileAction('{"type":"edit_file","path":"src/App.tsx","search":"old'),
    ).toBeNull();
  });
  it('parses valid generate_images action', () => {
    const action = parseAgentAction(
      JSON.stringify({
        type: 'generate_images',
        images: [
          { prompt: 'Modern hero banner', semanticUse: 'hero', placeholderToken: '__HERO_IMG__' },
        ],
      }),
    );
    expect(action.type).toBe('generate_images');
    if (action.type === 'generate_images') {
      expect(action.images).toHaveLength(1);
      expect(action.images[0]?.semanticUse).toBe('hero');
    }
  });

  it('accepts all planned image specs in one action and rejects empty plans', () => {
    const images = Array.from({ length: 6 }, (_, index) => ({
      prompt: `Image ${index + 1}`,
      semanticUse: `section-${index + 1}`,
      placeholderToken: `__SECTION_${index + 1}_IMG__`,
    }));
    const action = parseAgentAction(JSON.stringify({ type: 'generate_images', images }));
    expect(action.type).toBe('generate_images');
    if (action.type === 'generate_images') expect(action.images).toHaveLength(6);
    expect(() => parseAgentAction(JSON.stringify({ type: 'generate_images', images: [] }))).toThrow(
      'at least one image specification',
    );
  });

  it('rejects generate_images actions above the per-action cap', () => {
    const images = Array.from({ length: 9 }, (_, index) => ({
      prompt: `Image ${index + 1}`,
      semanticUse: `section-${index + 1}`,
      placeholderToken: `__SECTION_${index + 1}_IMG__`,
    }));
    expect(() => parseAgentAction(JSON.stringify({ type: 'generate_images', images }))).toThrow(
      'at most 8 image specifications',
    );
  });

  it('parses valid propose_design_directions action with exactly 3 concepts', () => {
    const action = parseAgentAction(
      JSON.stringify({
        type: 'propose_design_directions',
        directions: [
          {
            title: 'Concept 1',
            visualBrief: 'Brief 1',
            imagePrompt: 'Prompt 1',
            palette: { primary: '#000', secondary: '#111', background: '#fff', accent: '#222' },
            typography: { headingFont: 'Inter', bodyFont: 'Inter', styleNotes: 'Clean' },
            layoutNotes: 'Layout 1',
          },
          {
            title: 'Concept 2',
            visualBrief: 'Brief 2',
            imagePrompt: 'Prompt 2',
            palette: { primary: '#000', secondary: '#111', background: '#fff', accent: '#222' },
            typography: { headingFont: 'Roboto', bodyFont: 'Roboto', styleNotes: 'Modern' },
            layoutNotes: 'Layout 2',
          },
          {
            title: 'Concept 3',
            visualBrief: 'Brief 3',
            imagePrompt: 'Prompt 3',
            palette: { primary: '#000', secondary: '#111', background: '#fff', accent: '#222' },
            typography: { headingFont: 'Serif', bodyFont: 'Serif', styleNotes: 'Classic' },
            layoutNotes: 'Layout 3',
          },
        ],
      }),
    );
    expect(action.type).toBe('propose_design_directions');
    if (action.type === 'propose_design_directions') {
      expect(action.directions).toHaveLength(3);
      expect(action.directions[0].title).toBe('Concept 1');
    }
  });

  it('rejects propose_design_directions action with !== 3 concepts', () => {
    expect(() =>
      parseAgentAction(JSON.stringify({ type: 'propose_design_directions', directions: [] })),
    ).toThrow();
  });

  it('blocks design directions for existing projects and mixed turns', () => {
    const direction = {
      title: 'Concept',
      visualBrief: 'Brief',
      imagePrompt: 'Prompt',
      palette: { primary: '#000', secondary: '#111', background: '#fff', accent: '#222' },
      typography: { headingFont: 'Inter', bodyFont: 'Inter', styleNotes: 'Clean' },
      layoutNotes: 'Layout',
    };
    const proposal = parseAgentAction(
      JSON.stringify({
        type: 'propose_design_directions',
        directions: [direction, direction, direction],
      }),
    );

    expect(getDesignDirectionActionError(proposal, true)).toContain(
      'only available for an empty project',
    );
    expect(getDesignDirectionActionError(proposal, false)).toBeNull();

    const mixed = parseAgentAction(
      JSON.stringify([
        { type: 'propose_design_directions', directions: [direction, direction, direction] },
        { type: 'read_files', files: [{ path: 'src/App.tsx' }] },
      ]),
    );
    expect(getDesignDirectionActionError(mixed, false)).toContain('only action in their turn');
  });
});
