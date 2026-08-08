import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'coverage/**',
      'public/**',
      '.vite/**',
      'scripts/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Browsers render literal " ' just fine — ESLint flagging this as an
      // error is overkill for a private admin app. Demote to warn.
      'react/no-unescaped-entities': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // React 19's react-hooks/set-state-in-effect flags the standard
      // "auto-fetch on mount" pattern (useEffect → setLoading → fetch →
      // setData). The rule is technically correct that this causes a
      // cascading render, but the cascade is exactly what we want for
      // data loading. Demoted to warn.
      'react-hooks/set-state-in-effect': 'warn',
      // react-hooks/purity flags Date.now()/crypto calls used only inside
      // event-handler bodies (e.g. building a filename on click) — those
      // never run during render, the rule just can't prove it statically.
      // react-hooks/refs has the same false-positive shape for refs used as
      // plain mutable instance boxes (not DOM refs) read inside a handler.
      // Both demoted to warn, same reasoning as set-state-in-effect above.
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
    },
  },

  {
    files: ['server.ts', 'server/**/*.{ts,js}', 'test-api.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  prettier,
];
