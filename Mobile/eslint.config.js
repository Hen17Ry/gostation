// ESLint (flat config) : règles Expo (React, hooks, imports) + Prettier, et garde-fous du projet.
const { defineConfig } = require('eslint/config')
const expoConfig = require('eslint-config-expo/flat')
const prettier = require('eslint-config-prettier')

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['android/*', 'ios/*', '.expo/*', 'dist/*', 'coverage/*', 'src/api/schema.d.ts', 'src/theme/tokens.*'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-restricted-syntax': [
        'error',
        {
          // Couleurs : tokens uniquement (src/theme), jamais de valeur brute dans un composant.
          selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
          message: 'Couleur brute interdite : utiliser un token (useTheme().colors ou classe sémantique).',
        },
        {
          selector: 'Literal[value=/\\b(?:bg|text|border)-\\[#[0-9a-fA-F]{3,8}\\]/]',
          message: 'Couleur brute interdite : utiliser une classe sémantique (docs/design-system.md).',
        },
      ],
    },
  },
  {
    // Thème (définition des tokens) et vitrine de développement : valeurs brutes autorisées.
    files: ['src/theme/**', 'src/app/design.tsx'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Scripts Maestro (GraalJS) : variables fournies par Maestro.
    files: ['.maestro/**/*.js'],
    languageOptions: { globals: { http: 'readonly', json: 'readonly', output: 'writable', EMAIL: 'readonly' } },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**'],
    languageOptions: { globals: { jest: 'readonly' } },
  },
  prettier,
])
