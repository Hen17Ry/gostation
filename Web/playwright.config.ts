import { defineConfig, devices } from '@playwright/test'

/**
 * E2E contre la vraie API, sur une pile isolée de la base de dev (scripts/e2e-stack.sh) : base
 * gostation_e2e créée, migrée, remplie de données de démo et de fixtures, API sur 127.0.0.1:8095,
 * puis supprimée à la fin (globalTeardown). Le front est le build de production servi par
 * `vite preview` (pas de HMR), son proxy /api visant cette API.
 *
 * Un seul worker : la connexion admin est limitée à 5 par minute et par IP, et un pas TOTP déjà
 * accepté est refusé (anti-rejeu). Le projet `setup` se connecte une fois et partage la session
 * (storageState) avec les scénarios d'administration.
 *
 * E2E_TARGET=staging (`npm run e2e:staging`) : mêmes scénarios contre l'admin et l'API publics du
 * staging (TLS, CSP et en-têtes réels). Fixtures et admins de test créés sur le serveur par SSH
 * (scripts/staging.sh), puis supprimés avec leurs données (scripts/prod.sh e2e-cleanup).
 */
const API = '127.0.0.1:8095'
export const STAGING = process.env.E2E_TARGET === 'staging'
const STAGING_ADMIN = process.env.E2E_BASE_URL ?? 'https://admin.gostation.bj'
export const STORAGE_STATE = 'playwright/.auth/admin.json'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: STAGING ? './e2e/support/staging-setup.ts' : undefined,
  globalTeardown: './e2e/support/teardown.ts',
  use: {
    baseURL: STAGING ? STAGING_ADMIN : 'http://127.0.0.1:4173',
    locale: 'fr-FR',
    timezoneId: 'Africa/Porto-Novo',
    trace: 'retain-on-failure',
    acceptDownloads: true,
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'e2e',
      testIgnore: /screenshots\.spec\.ts|auth\.setup\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'screenshots',
      testMatch: /screenshots\.spec\.ts/,
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: STAGING
    ? undefined
    : [
        {
          command: 'bash ../scripts/e2e-stack.sh up',
          url: `http://${API}/readyz`,
          reuseExistingServer: !process.env.CI,
          timeout: 300_000,
          stdout: 'pipe',
        },
        {
          command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
          url: 'http://127.0.0.1:4173/login',
          env: { VITE_API_PROXY_TARGET: `http://${API}` },
          reuseExistingServer: !process.env.CI,
          timeout: 180_000,
        },
      ],
})
