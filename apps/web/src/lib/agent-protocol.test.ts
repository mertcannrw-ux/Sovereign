import { describe, expect, it } from 'vitest';
import { applyAgentEdit, getAgentFileMutationPaths, getDesignDirectionActionError, getStreamingFileAction, getStreamingThought, isSafeAgentPath, parseAgentAction } from '@/lib/agent-protocol';

describe('agent protocol', () => {
  it('parses one planned action', () => {
    expect(parseAgentAction(JSON.stringify({
      type: 'think',
      summary: 'Plan the application',
      content: 'Inspect the existing entry point, then build the requested React experience.',
    }))).toEqual({
      type: 'think',
      summary: 'Plan the application',
      content: 'Inspect the existing entry point, then build the requested React experience.',
    });
  });

  it('preserves complete write contents', () => {
    expect(parseAgentAction(JSON.stringify({
      type: 'write_file',
      path: 'src/App.tsx',
      content: 'export default function App() { return <main />; }',
    }))).toEqual({
      type: 'write_file',
      path: 'src/App.tsx',
      content: 'export default function App() { return <main />; }',
    });
  });

  it('rejects filesystem escape paths', () => {
    expect(isSafeAgentPath('src/App.tsx')).toBe(true);
    expect(isSafeAgentPath('../secret.txt')).toBe(false);
    expect(isSafeAgentPath('/etc/passwd')).toBe(false);
    expect(() => parseAgentAction('{"type":"delete_file","path":"../secret.txt"}')).toThrow('invalid');
  });

  it('requires an edit search to match exactly once', () => {
    expect(applyAgentEdit('before unique after', 'unique', 'changed')).toBe('before changed after');
    expect(() => applyAgentEdit('same same', 'same', 'changed')).toThrow('found 2');
    expect(() => applyAgentEdit('missing', 'other', 'changed')).toThrow('found 0');
  });

  it('accepts exactly three useful clarification options', () => {
    expect(parseAgentAction(JSON.stringify({
      type: 'ask_questions',
      questions: [{ question: 'Which audience?', options: ['Consumers', 'Teams', 'Enterprises'] }],
    }))).toEqual({
      type: 'ask_questions',
      questions: [{ question: 'Which audience?', options: ['Consumers', 'Teams', 'Enterprises'] }],
    });
  });

  it('treats normal text as a direct conversational reply', () => {
    expect(parseAgentAction('Yes — the preview updates after every completed file write.')).toEqual({
      type: 'respond',
      message: 'Yes — the preview updates after every completed file write.',
    });
  });

  it('rejects malformed file actions instead of leaking them into chat', () => {
    expect(() => parseAgentAction('I will update it now.\n{"type":"edit_file","path":"src/App.tsx","search":"old","replace":"new"')).toThrow();
  });

  it('reports the mutation path for one parsed filesystem action', () => {
    const action = parseAgentAction('{"type":"edit_file","path":"src/App.tsx","search":"old","replace":"new"}');
    expect([...getAgentFileMutationPaths(action)]).toEqual(['src/App.tsx']);
  });

  it('parses an explicit conversational response action', () => {
    expect(parseAgentAction('{"type":"respond","message":"What would you like to adjust?"}')).toEqual({
      type: 'respond',
      message: 'What would you like to adjust?',
    });
  });

  it('decodes partial thinking content while JSON is still streaming', () => {
    expect(getStreamingThought('{"type":"think","summary":"Planning","content":"Inspect the app\\nThen build')).toBe(
      'Inspect the app\nThen build',
    );
    expect(getStreamingThought('{"type":"write_file","path":"src/App.tsx","content":"secret source')).toBeNull();
  });

  it('extracts multiple tool actions after prose without leaking them as chat', () => {
    const action = parseAgentAction(`I'll add the remaining files now.\n\n{"type":"write_file","path":"index.html","content":"<main></main>"}\n\n{"type":"write_file","path":"src/main.tsx","content":"render();"}`);
    expect(action).toEqual({
      type: 'batch',
      actions: [
        { type: 'write_file', path: 'index.html', content: '<main></main>' },
        { type: 'write_file', path: 'src/main.tsx', content: 'render();' },
      ],
    });
  });

  it('accepts a JSON array of tool actions', () => {
    expect(parseAgentAction('[{"type":"delete_file","path":"old.css"},{"type":"read_files","files":[{"path":"src/App.tsx","startLine":120,"endLine":220}]}]')).toEqual({
      type: 'batch',
      actions: [
        { type: 'delete_file', path: 'old.css' },
        { type: 'read_files', files: [{ path: 'src/App.tsx', startLine: 120, endLine: 220 }] },
      ],
    });
  });

  it('supports full reads and open-ended line ranges', () => {
    expect(parseAgentAction('{"type":"read_files","files":[{"path":"src/App.tsx"},{"path":"src/index.css","startLine":80},{"path":"package.json","endLine":12}]}')).toEqual({
      type: 'read_files',
      files: [
        { path: 'src/App.tsx' },
        { path: 'src/index.css', startLine: 80 },
        { path: 'package.json', endLine: 12 },
      ],
    });
  });

  it('rejects reversed or non-positive read ranges', () => {
    expect(() => parseAgentAction('{"type":"read_files","files":[{"path":"src/App.tsx","startLine":20,"endLine":10}]}')).toThrow('reversed line range');
    expect(() => parseAgentAction('{"type":"read_files","files":[{"path":"src/App.tsx","startLine":0}]}')).toThrow('invalid line bounds');
  });

  it('accepts underspecified thinking actions without failing the run', () => {
    expect(parseAgentAction('{"type":"think","content":"I should inspect the current page."}')).toEqual({
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
    expect(getStreamingFileAction('{"type": "write_file", "path": "src/App.tsx", "content": "line one\\nline two')).toEqual({
      type: 'write_file',
      path: 'src/App.tsx',
      content: 'line one\nline two',
    });
  });

  it('builds provisional edits only after the exact search text is complete', () => {
    expect(getStreamingFileAction('{"type":"edit_file","path":"src/App.tsx","search":"old","replace":"new')).toEqual({
      type: 'edit_file',
      path: 'src/App.tsx',
      search: 'old',
      replace: 'new',
    });
    expect(getStreamingFileAction('{"type":"edit_file","path":"src/App.tsx","search":"old')).toBeNull();
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
    expect(() =>
      parseAgentAction(JSON.stringify({ type: 'generate_images', images: [] })),
    ).toThrow('at least one image specification');
  });

  it('rejects generate_images actions above the per-action cap', () => {
    const images = Array.from({ length: 9 }, (_, index) => ({
      prompt: `Image ${index + 1}`,
      semanticUse: `section-${index + 1}`,
      placeholderToken: `__SECTION_${index + 1}_IMG__`,
    }));
    expect(() =>
      parseAgentAction(JSON.stringify({ type: 'generate_images', images })),
    ).toThrow('at most 8 image specifications');
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
    const proposal = parseAgentAction(JSON.stringify({
      type: 'propose_design_directions',
      directions: [direction, direction, direction],
    }));

    expect(getDesignDirectionActionError(proposal, true)).toContain('only available for an empty project');
    expect(getDesignDirectionActionError(proposal, false)).toBeNull();

    const mixed = parseAgentAction(JSON.stringify([
      { type: 'propose_design_directions', directions: [direction, direction, direction] },
      { type: 'read_files', files: [{ path: 'src/App.tsx' }] },
    ]));
    expect(getDesignDirectionActionError(mixed, false)).toContain('only action in their turn');
  });
});
