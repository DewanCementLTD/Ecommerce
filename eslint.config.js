import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/coverage/**',
      // The client admin builds into the storefront's public/ so it can be
      // served at {store-domain}/admin. That is minified vendor output, not
      // source — linting it reports a hundred problems in React's own code.
      'storefront/public/admin/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['api/**/*.js', 'scripts/**/*.js', 'shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
  {
    // PM2 reads its config with `require`, so this one file is CommonJS in a
    // repo that is otherwise ESM — `__dirname` and friends are real here.
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },
  {
    files: ['admin/**/*.{js,jsx}', 'superadmin/**/*.{js,jsx}', 'storefront/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
  {
    // These drive a real browser: the functions they inject run in the page,
    // not in Node, so they legitimately reference document/window.
    files: ['scripts/ui-check.js', 'scripts/smoke-panels.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['**/*.test.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  prettierConfig,
];
