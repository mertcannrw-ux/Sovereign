import { stringifyJson } from './json-repair';
import stackLock from './stack-lock.json';

export const REQUIRED_FILE_PATHS = [
  'package.json',
  'vite.config.ts',
  'tsconfig.json',
  'index.html',
  'src/main.tsx',
  'src/App.tsx',
  'src/index.css',
  'src/ErrorBoundary.tsx',
  '.env.example',
  'eslint.config.js',
  'SOVEREIGN.md',
] as const;

export type RequiredFilePath = (typeof REQUIRED_FILE_PATHS)[number];

export function seedPackageJson(): string {
  return stringifyJson({
    name: 'generated-app',
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: stackLock.scripts,
    dependencies: stackLock.dependencies,
    devDependencies: stackLock.devDependencies,
  });
}

export const SEED_VITE_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
`;

export function seedTsconfig(): string {
  return stringifyJson({
    compilerOptions: {
      target: 'ES2022',
      useDefineForClassFields: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      skipLibCheck: true,
      moduleResolution: 'bundler',
      isolatedModules: true,
      moduleDetection: 'force',
      noEmit: true,
      jsx: 'react-jsx',
      strict: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      noFallthroughCasesInSwitch: true,
    },
    include: ['src'],
  });
}

export const SEED_INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Generated application" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

export const SEED_MAIN_TSX = `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ErrorBoundary } from './ErrorBoundary';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
`;

export const SEED_APP_TSX = `export default function App() {
  return (
    <main>
      <h1>Welcome</h1>
    </main>
  );
}
`;

export const SEED_INDEX_CSS = `:root {
  color-scheme: light dark;
  --bg: #0f172a;
  --fg: #f8fafc;
  --muted: #cbd5e1;
  --accent: #38bdf8;
  --focus: #facc15;
}

html,
body,
#root {
  min-height: 100%;
  margin: 0;
}

body {
  background: var(--bg);
  color: var(--fg);
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  line-height: 1.5;
}

a {
  color: var(--accent);
}

:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  html {
    scroll-behavior: auto;
  }
}
`;

export const SEED_ERROR_BOUNDARY = `import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('App error:', error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main>
          <h1>Something went wrong</h1>
          <p>Reload the page to try again.</p>
        </main>
      );
    }
    return this.props.children;
  }
}
`;

export const SEED_ENV_EXAMPLE = `# Public compile-time values only. Never put secrets here.
# VITE_* keys are inlined into the client bundle.
VITE_APP_TITLE=
`;

export const SEED_ESLINT_CONFIG = `import jsxA11y from 'eslint-plugin-jsx-a11y';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: { 'jsx-a11y': jsxA11y },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...jsxA11y.configs.recommended.rules,
    },
  },
];
`;

export const SEED_SOVEREIGN_MD = `# Sovereign stack rules

This project is a static Vite + React 19 + TypeScript SPA.

- Keep React 19, Vite, and TypeScript. Do not switch to Next.js or add SSR/API routes.
- \`vite.config.ts\` must use \`@vitejs/plugin-react\` only. Never import \`@app-builder/visual-editor\`.
- \`tsconfig.json\` must set \`"jsx": "react-jsx"\`.
- Public env vars are compile-time \`VITE_*\` keys. Never write \`.env\`; use \`.env.example\`.
- \`src/ErrorBoundary.tsx\` is required — restyle if needed, do not delete.
- Wrap the app in \`<main>\`. \`index.html\` needs \`lang\`, viewport, title, description, and \`/src/main.tsx\`.
`;

export const SEEDS: Record<RequiredFilePath, string> = {
  'package.json': seedPackageJson(),
  'vite.config.ts': SEED_VITE_CONFIG,
  'tsconfig.json': seedTsconfig(),
  'index.html': SEED_INDEX_HTML,
  'src/main.tsx': SEED_MAIN_TSX,
  'src/App.tsx': SEED_APP_TSX,
  'src/index.css': SEED_INDEX_CSS,
  'src/ErrorBoundary.tsx': SEED_ERROR_BOUNDARY,
  '.env.example': SEED_ENV_EXAMPLE,
  'eslint.config.js': SEED_ESLINT_CONFIG,
  'SOVEREIGN.md': SEED_SOVEREIGN_MD,
};

export function isForbiddenEnvPath(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  if (base === '.env.example') return false;
  return base === '.env' || base.startsWith('.env.');
}

export function sanitizeEnvExample(content: string): string {
  const lines = content.split(/\r?\n/);
  const kept = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return true;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) return true;
    const key = trimmed.slice(0, eq).trim();
    return key.startsWith('VITE_');
  });
  const result = kept.join('\n');
  return result.endsWith('\n') || result.length === 0 ? result : `${result}\n`;
}
