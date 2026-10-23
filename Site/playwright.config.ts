import { defineConfig, devices } from '@playwright/test'

/**
 * E2E du site public sur le build (scripts/preview.mjs : mêmes en-têtes et même CSP que Caddy).
 * - e2e, e2e-mobile : modes d'animation, CSP, accessibilité (npm run e2e) ;
 * - record : vidéos et captures du parcours dans docs/landing/ (npm run record, jamais en CI).
 * Chromium utilise le GPU de la machine quand il y en a un (ANGLE) : sans GPU, WebGL passe par
 * SwiftShader et le site bascule souvent en mode léger, ce que les tests acceptent.
 */
const gpu = ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-unsafe-swiftshader']

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4322',
    launchOptions: { args: gpu },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/preview.mjs',
    url: 'http://127.0.0.1:4322',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    {
      name: 'e2e',
      testMatch: /\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'e2e-mobile', testMatch: /\.spec\.ts$/, use: { ...devices['Pixel 7'] } },
    { name: 'record', testMatch: /record\.ts$/, timeout: 180_000, fullyParallel: false },
  ],
})
