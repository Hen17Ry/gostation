import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import astro from 'eslint-plugin-astro'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', '.astro', 'playwright-report', 'test-results', 'src/lib/tokens.generated.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs['flat/recommended'],
  ...astro.configs['flat/jsx-a11y-recommended'],
  {
    languageOptions: { globals: globals.browser },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/^#[0-9a-fA-F]{3,8}$/]',
          message: 'Couleur brute interdite : utiliser un token (src/lib/tokens.generated.ts ou les variables CSS).',
        },
      ],
    },
  },
  {
    // Zone de défilement d'un tableau : focusable au clavier (role="region"), comme le veut axe.
    rules: { 'astro/jsx-a11y/no-noninteractive-tabindex': ['error', { roles: ['region'] }] },
  },
  {
    // Palette des cartes : miroir de celle de l'app (vérifiée par map-palette.test.ts), un fichier de tokens.
    files: ['src/lib/map-palette.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: [
      'e2e/**/*.ts',
      'playwright.config.ts',
      'vitest.config.ts',
      'astro.config.mjs',
      'scripts/**/*.mjs',
      'scripts/**/*.mts',
      'build/**/*.mts',
    ],
    languageOptions: { globals: globals.node },
  },
  prettier,
)
