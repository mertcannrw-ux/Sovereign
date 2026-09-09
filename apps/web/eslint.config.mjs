import nextPlugin from '@next/eslint-plugin-next';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    files: ['src/**/*.{js,mjs,cjs,ts,jsx,tsx}'],
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
      '@typescript-eslint': tsPlugin,
      'react-hooks': reactHooks,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // Allow existing `any` casts to keep the baseline green; type-aware linting
      // is a follow-up.
      '@typescript-eslint/no-explicit-any': 'off',
      // Newer react-hooks v7 rules are stricter than the codebase's current
      // style. Surface them as warnings (not build-breaking errors) until the
      // offending components are refactored.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/static-components': 'warn',
      // The ref-mirror pattern (`latestRef.current = value` during render) is
      // used deliberately in the generation/preview hooks so event callbacks
      // read fresh values without effect lag. Same rationale as above: warn,
      // don't break the build, until those hooks are migrated.
      'react-hooks/refs': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    ignores: ['**/node_modules/**', '**/.next/**', '**/dist/**'],
  },
];
