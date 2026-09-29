// HELPZY uses a single ESLint flat config at the repository root so that every
// workspace (frontend, backend, shared packages) is linted with the same rules
// and the same Prettier formatting. Each workspace keeps a `lint` script that
// runs `eslint .` from its own directory; ESLint walks up to this file.
import js from '@eslint/js';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-android/**',
      '**/dist-ios/**',
      '**/build/**',
      '**/.expo/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'docs/**',
      'pnpm-lock.yaml',
      'PBL Template.pdf',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierRecommended,
  {
    // House rules. Declared before the file-specific blocks so a later block can
    // legitimately turn a rule off for a directory that needs it.
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    // Node-flavoured code: NestJS backend, shared packages, config and scripts.
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: globals.node,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    },
  },
  {
    // The shared packages are isomorphic - they run in Node (backend) and in
    // the browser / React Native runtime (frontend).
    files: ['packages/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Frontend: React Native + React Native Web, so browser globals are the
    // closest available set and the Rules of Hooks are enforced.
    files: ['apps/frontend/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    // Build-time and one-off scripts report to the terminal on purpose.
    files: ['**/*.config.js', '**/*.config.cjs', '**/*.cjs', 'scripts/**', '**/prisma/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-console': 'off',
    },
  },
);
