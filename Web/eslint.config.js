import js from '@eslint/js'
import pluginQuery from '@tanstack/eslint-plugin-query'
import pluginRouter from '@tanstack/eslint-plugin-router'
import prettier from 'eslint-config-prettier'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist',
      'coverage',
      'playwright-report',
      'test-results',
      'playwright/.auth',
      'src/routeTree.gen.ts',
      'src/api/schema.d.ts',
    ],
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
      jsxA11y.flatConfigs.recommended,
      ...pluginQuery.configs['flat/recommended'],
      ...pluginRouter.configs['flat/recommended'],
    ],
    languageOptions: { ecmaVersion: 2023, globals: globals.browser },
    plugins: { 'react-refresh': reactRefresh },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true, allowExportNames: ['Route'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/\\b(?:bg|text|border|fill|stroke|ring)-\\[#[0-9a-fA-F]{3,8}\\]/]',
          message: 'Couleur brute interdite : utiliser un token (docs/design-system.md).',
        },
      ],
    },
  },
  {
    // Primitives shadcn (variantes exportées) et routes TanStack (le plugin découpe le code).
    files: ['src/components/ui/**/*.tsx', 'src/routes/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['e2e/**/*.ts', 'playwright.config.ts', 'vite.config.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  prettier,
)
