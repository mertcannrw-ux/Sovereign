import nextPlugin from '@next/eslint-plugin-next';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    // Flat-config `files` patterns are resolved against the config file's own
    // directory (the repo root), NOT the linting CWD. Package lint scripts run
    // `eslint .` from inside packages/*, so patterns anchored at the root like
    // `src/**` matched nothing there and every package lint failed with "all
    // files ignored". `**/src/**` covers every workspace from any CWD.
    files: ['**/src/**/*.{js,mjs,cjs,ts,jsx,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      '@next/next': nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  {
    ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**'],
  },
];
