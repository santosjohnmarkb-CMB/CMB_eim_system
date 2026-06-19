import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    ignores: ['dist', 'dist-main', 'release', 'node_modules', '**/*.d.ts'],
  },

  // Base JS + TypeScript recommended rules (non type-checked: fast, no project service needed).
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Renderer (browser) source.
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Main process, preload, and shared code run under Node/Electron.
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'src/shared/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // Build/config files and standalone Node scripts.
  {
    files: ['*.{js,cjs,mjs,ts}', 'vite.config.ts', 'scripts/**/*.{js,cjs,mjs,ts}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Project-wide rule tuning. The Electron main/IPC layer intentionally uses `any`
  // for better-sqlite3 rows and IPC payloads, so explicit-any is allowed; unused
  // identifiers are warnings and may be prefixed with `_` to opt out.
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
);
