import { describe, expect, it } from 'vitest';
import { appendGenerationContinuation, applyGeneratedPatches, getActiveGeneratedFile, getGenerationContinuationPrompt, isGenerationArtifactComplete, parseGenerationArtifact, parsePatchArtifact } from '@/lib/generation-protocol';

describe('generation artifact protocol', () => {
  it('parses a summary and complete project files', () => {
    const artifact = parseGenerationArtifact(`<<<MESSAGE>>>
Built a landing page.
<<<END_MESSAGE>>>
<<<FILE:index.html>>>
<h1>Hello</h1>
<<<END_FILE>>>
<<<FILE:src/main.js>>>
console.log('ready');
<<<END_FILE>>>`);

    expect(artifact).toEqual({
      message: 'Built a landing page.',
      questions: [],
      files: [
        { path: 'index.html', content: '<h1>Hello</h1>' },
        { path: 'src/main.js', content: "console.log('ready');" },
      ],
    });
  });

  it('parses structured clarification questions with three recommendations', () => {
    expect(parseGenerationArtifact(`<<<QUESTIONS>>>
[{"question":"Who is the primary audience?","options":["Consumers","Small businesses","Enterprise teams"]}]
<<<END_QUESTIONS>>>`)).toEqual({
      message: '',
      questions: [{
        question: 'Who is the primary audience?',
        options: ['Consumers', 'Small businesses', 'Enterprise teams'],
      }],
      files: [],
    });
  });

  it('keeps older string-only clarification responses usable', () => {
    expect(parseGenerationArtifact(`<<<QUESTIONS>>>
["Should users sign in?"]
<<<END_QUESTIONS>>>`).questions).toEqual([{
      question: 'Should users sign in?',
      options: ['Use the recommended approach', 'Keep it simple', 'Make it feature-rich'],
    }]);
  });

  it('rejects paths that can escape the sandbox', () => {
    const artifact = parseGenerationArtifact(`<<<FILE:../secret.txt>>>
nope
<<<END_FILE>>>
<<<FILE:/absolute.txt>>>
nope
<<<END_FILE>>>
<<<FILE:src/safe.css>>>
body{}
<<<END_FILE>>>`);

    expect(artifact).toMatchObject({ files: [{ path: 'src/safe.css', content: 'body{}' }] });
  });

  it('reports the currently streamed file before its end marker arrives', () => {
    expect(getActiveGeneratedFile('<<<FILE:src/app.js>>>\nconst ready = true;')).toEqual({
      path: 'src/app.js',
      content: 'const ready = true;',
    });
  });

  it('requires an explicit whole-build terminator', () => {
    expect(isGenerationArtifactComplete('<<<FILE:index.html>>>\n<h1>Done</h1>\n<<<END_FILE>>>')).toBe(false);
    expect(isGenerationArtifactComplete('<<<FILE:index.html>>>\n<h1>Done</h1>\n<<<END_FILE>>>\n<<<END_BUILD>>>')).toBe(true);
    expect(isGenerationArtifactComplete('<<<FILE:index.html>>>\n<h1>Still writing')).toBe(false);
    expect(isGenerationArtifactComplete('<<<QUESTIONS>>>\n["Which audience?"]')).toBe(false);
    expect(isGenerationArtifactComplete('<<<QUESTIONS>>>\n["Which audience?"]\n<<<END_QUESTIONS>>>')).toBe(true);
  });

  it('resumes inside a truncated file without restarting its marker', () => {
    const prompt = getGenerationContinuationPrompt('<<<FILE:src/game.js>>>\nfunction update() {');
    expect(prompt).toContain('truncated inside "src/game.js"');
    expect(prompt).toContain('Do not repeat the file marker');
  });

  it('continues after closed files without re-emitting them', () => {
    const prompt = getGenerationContinuationPrompt('<<<FILE:index.html>>>\n<h1>Done</h1>\n<<<END_FILE>>>');
    expect(prompt).toContain('Completed files: index.html');
    expect(prompt).toContain('Begin with the next required file marker');
  });

  it('merges a repeated current-file marker without duplicating content', () => {
    const partial = '<<<FILE:src/game.js>>>\nfunction update() {';
    const continuation = '<<<FILE:src/game.js>>>\nfunction update() {\n  render();\n}\n<<<END_FILE>>>\n<<<END_BUILD>>>';
    expect(appendGenerationContinuation(partial, continuation)).toBe(
      '<<<FILE:src/game.js>>>\nfunction update() {\n  render();\n}\n<<<END_FILE>>>\n<<<END_BUILD>>>',
    );
  });

  it('appends a raw continuation suffix unchanged', () => {
    expect(appendGenerationContinuation(
      '<<<FILE:src/game.js>>>\nfunction update() {',
      '\n  render();\n}\n<<<END_FILE>>>\n<<<END_BUILD>>>',
    )).toContain('function update() {\n  render();');
  });

  it('deduplicates the same file path keeping the last occurrence', () => {
    const artifact = parseGenerationArtifact(`<<<FILE:index.html>>>
<h1>First</h1>
<<<END_FILE>>>
<<<FILE:index.html>>>
<h1>Final</h1>
<<<END_FILE>>>`);

    expect(artifact).toMatchObject({ files: [{ path: 'index.html', content: '<h1>Final</h1>' }] });
  });
  it('parses and applies one exact targeted patch without changing other files', () => {
    const artifact = parsePatchArtifact(`<<<MESSAGE>>>
Updated the selected heading.
<<<END_MESSAGE>>>
<<<PATCH:index.html>>>
<<<<<<< SEARCH
<h1 class="hero">Old title</h1>
=======
<h1 class="hero">New title</h1>
>>>>>>> REPLACE
<<<END_PATCH>>>
<<<END_BUILD>>>`);
    const files = [
      { path: 'index.html', content: '<main>\n<h1 class="hero">Old title</h1>\n</main>' },
      { path: 'src/main.js', content: 'boot();' },
    ];

    expect(artifact.message).toBe('Updated the selected heading.');
    expect(applyGeneratedPatches(files, artifact.patches)).toEqual([
      { path: 'index.html', content: '<main>\n<h1 class="hero">New title</h1>\n</main>' },
      { path: 'src/main.js', content: 'boot();' },
    ]);
  });

  it('rejects a targeted patch when its search text is ambiguous', () => {
    expect(() => applyGeneratedPatches(
      [{ path: 'index.html', content: '<span>same</span><span>same</span>' }],
      [{ path: 'index.html', search: '<span>same</span>', replace: '<span>changed</span>' }],
    )).toThrow('could not uniquely locate');
  });

});
