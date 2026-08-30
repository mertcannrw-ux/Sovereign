import { describe, expect, it } from 'vitest';
import { applyStackContract, isForbiddenEnvPath, REQUIRED_FILE_PATHS } from './contract';
import stackLock from './stack-lock.json';

function pathsOf(files: Map<string, string>): string[] {
  return [...files.keys()].sort();
}

describe('isForbiddenEnvPath', () => {
  it('refuses .env and env variants but allows .env.example', () => {
    expect(isForbiddenEnvPath('.env')).toBe(true);
    expect(isForbiddenEnvPath('.env.local')).toBe(true);
    expect(isForbiddenEnvPath('src/.env.production')).toBe(true);
    expect(isForbiddenEnvPath('.env.example')).toBe(false);
    expect(isForbiddenEnvPath('src/App.tsx')).toBe(false);
  });
});

describe('applyStackContract', () => {
  it('seeds every required file for an empty tree', () => {
    const result = applyStackContract(new Map());
    expect(pathsOf(result.files)).toEqual([...REQUIRED_FILE_PATHS].sort());
    expect(result.seeded).toEqual(expect.arrayContaining([...REQUIRED_FILE_PATHS]));
    expect(result.syntheticToolResult).toContain('autofix result:');
    expect(result.files.get('.env.example')).toMatch(/VITE_APP_TITLE=/);
    expect(result.files.get('.env.example')).not.toMatch(/^(?!VITE_|#)[A-Z0-9_]+=/m);
    expect(result.files.get('src/App.tsx')).toContain('<main>');
    expect(result.files.get('src/main.tsx')).toContain('ErrorBoundary');
    expect(result.files.get('src/main.tsx')).toContain('createRoot');
    expect(result.files.get('vite.config.ts')).toContain('@vitejs/plugin-react');
    expect(result.files.get('vite.config.ts')).not.toContain('@app-builder/visual-editor');
    expect(result.files.get('SOVEREIGN.md')).toContain('Vite');
    const pkg = JSON.parse(result.files.get('package.json')!);
    expect(pkg.dependencies.react).toBe(stackLock.dependencies.react);
    expect(pkg.scripts).toMatchObject(stackLock.scripts);
    expect(JSON.parse(result.files.get('tsconfig.json')!).compilerOptions.jsx).toBe('react-jsx');
    expect(result.files.has('.env')).toBe(false);
  });

  it('does not overwrite an existing App.tsx and re-seeds a deleted ErrorBoundary', () => {
    const app = 'export default function App() { return <main>Hello shop</main>; }\n';
    const result = applyStackContract(new Map([['src/App.tsx', app]]));
    expect(result.files.get('src/App.tsx')).toBe(app);
    expect(result.seeded).toContain('src/ErrorBoundary.tsx');
    expect(result.files.get('src/ErrorBoundary.tsx')).toContain('getDerivedStateFromError');
  });

  it('repairs package.json / tsconfig.json and completes stack dependencies', () => {
    const result = applyStackContract(
      new Map([
        ['package.json', '{"name":"shop","dependencies":{"react":"^18.0.0",}'],
        ['tsconfig.json', '{"compilerOptions":{"target":"ES2020",}'],
        ['src/App.tsx', 'export default function App() { return <main />; }'],
      ]),
    );
    const pkg = JSON.parse(result.files.get('package.json')!);
    expect(pkg.dependencies.react).toBe(stackLock.dependencies.react);
    expect(pkg.dependencies['react-dom']).toBe(stackLock.dependencies['react-dom']);
    expect(pkg.devDependencies.vite).toBe(stackLock.devDependencies.vite);
    expect(JSON.parse(result.files.get('tsconfig.json')!).compilerOptions.jsx).toBe('react-jsx');
    expect(result.repaired).toEqual(expect.arrayContaining(['package.json', 'tsconfig.json']));
  });

  it('rewrites lucide-react imports and adds the locked dependency', () => {
    const result = applyStackContract(
      new Map([
        [
          'src/App.tsx',
          `import { HomeIcon, NopeIcon } from 'lucide-react';
export default function App() {
  return <main><HomeIcon /><NopeIcon /></main>;
}
`,
        ],
      ]),
    );
    const app = result.files.get('src/App.tsx')!;
    expect(app).toContain('House');
    expect(app).toContain('Circle');
    expect(app).not.toContain('HomeIcon');
    expect(app).not.toContain('NopeIcon');
    const pkg = JSON.parse(result.files.get('package.json')!);
    expect(pkg.dependencies['lucide-react']).toBe(stackLock.conditionalDependencies['lucide-react']);
  });

  it('strips visual-editor from vite.config.ts and patches index.html', () => {
    const result = applyStackContract(
      new Map([
        [
          'vite.config.ts',
          `import react from '@vitejs/plugin-react';
import { visualEditor } from '@app-builder/visual-editor';
export default {
  plugins: [react(), visualEditor({ root: 'src' })],
  resolve: { alias: { '@': '/src' } },
  server: { port: 4173 },
};
`,
        ],
        [
          'index.html',
          '<html><head></head><body><div id="root"></div><script type="module" src="./src/main.tsx"></script></body></html>',
        ],
        ['src/App.tsx', 'export default function App() { return <main />; }'],
      ]),
    );
    const vite = result.files.get('vite.config.ts')!;
    expect(vite).toContain('@vitejs/plugin-react');
    expect(vite).toContain("alias: { '@': '/src' }");
    expect(vite).toContain('port: 4173');
    expect(vite).not.toContain('@app-builder/visual-editor');
    expect(vite).not.toContain('visualEditor');
    const html = result.files.get('index.html')!;
    expect(html).toMatch(/<html[^>]*lang="en"/);
    expect(html).toContain('name="viewport"');
    expect(html).toContain('name="description"');
    expect(html).toContain('<title>');
    expect(html).toContain('src="/src/main.tsx"');
    expect(html.match(/src\/main\.tsx/g)).toHaveLength(1);
  });

  it('does not wipe extra tsconfig options when JSON cannot be repaired', () => {
    const broken = 'compilerOptions jsx preserve extras keep';
    const result = applyStackContract(
      new Map([
        ['tsconfig.json', broken],
        ['src/App.tsx', 'export default function App() { return <main />; }'],
      ]),
    );
    expect(result.files.get('tsconfig.json')).toBe(broken);
  });

  it('deletes .env and strips non-VITE_ keys from .env.example', () => {
    const result = applyStackContract(
      new Map([
        ['.env', 'SECRET=totally-secret\nVITE_OK=1\n'],
        ['.env.example', 'VITE_APP_TITLE=Shop\nDATABASE_URL=postgres://x\nOPENAI_API_KEY=sk-x\n'],
        ['src/App.tsx', 'export default function App() { return <main />; }'],
      ]),
    );
    expect(result.files.has('.env')).toBe(false);
    expect(result.changes.some((change) => change.path === '.env' && change.operation === 'delete')).toBe(true);
    const example = result.files.get('.env.example')!;
    expect(example).toContain('VITE_APP_TITLE=Shop');
    expect(example).not.toContain('DATABASE_URL');
    expect(example).not.toContain('OPENAI_API_KEY');
  });

  it('rewrites preview asset URLs when replacements are provided', () => {
    const source = 'http://localhost:3000/api/assets/projects/p/a.png?sig=1';
    const result = applyStackContract(new Map([['src/App.tsx', `<img src="${source}" />`]]), {
      assetUrlReplacements: new Map([[source, '/__sovereign_assets/a.png']]),
    });
    expect(result.files.get('src/App.tsx')).toContain('/__sovereign_assets/a.png');
    expect(result.files.get('src/App.tsx')).not.toContain('/api/assets/');
  });

  it('finishes a typical tree in well under 50ms', () => {
    const files = new Map<string, string>([
      ['src/App.tsx', `import { HomeIcon } from 'lucide-react';\nexport default function App() { return <main><HomeIcon /></main>; }\n`],
      ['package.json', '{"name":"shop","dependencies":{"react":"^18.0.0",}'],
    ]);
    const start = performance.now();
    applyStackContract(files);
    expect(performance.now() - start).toBeLessThan(50);
  });
});
