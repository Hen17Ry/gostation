import { defineConfig, devices } from '@playwright/test'

/**
 * E2E contre la vraie API (make up && make api-up), sur le build de production servi par
 * `vite preview` et son proxy (pas de HMR pendant les tests, bundle réel). Un seul
 * worker : la connexion admin est limitée à 5 par minute et par IP, et un pas TOTP déjà accepté
 * est refusé (anti-rejeu).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    locale: 'fr-FR',
    timezoneId: 'Africa/Porto-Novo',
    trace: 'retain-on-failure',
    acceptDownloads: true,
  },
  projects: [
    { name: 'e2e', testIgnore: /screenshots\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    { name: 'screenshots', testMatch: /screenshots\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/login',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
