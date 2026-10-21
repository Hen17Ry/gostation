/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

import { securityHeaders } from './build/csp.ts'
import { routePreload } from './build/route-preload.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  // En dev, l'API est servie par le proxy : même origine, donc cookies SameSite=Strict et jeton
  // CSRF lisible. En prod, VITE_API_BASE_URL pointe sur https://api.<domaine> (même site).
  const apiTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8080'
  const proxy = { '/api': { target: apiTarget, changeOrigin: false, xfwd: true } }

  return {
    plugins: [
      tanstackRouter({ target: 'react', autoCodeSplitting: true }),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      tailwindcss(),
      routePreload(
        { '/login': /src\/routes\/login\.tsx\?tsr-split/, '/': /src\/routes\/_app\/index\.tsx\?tsr-split/ },
        /geist-latin-wght-normal-[\w-]+\.woff2$/,
      ),
      // Après routePreload : la CSP porte l'empreinte de son script en ligne.
      securityHeaders(env.VITE_API_BASE_URL),
    ],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy,
      // Les rapports Playwright et les captures ne doivent pas recharger les pages ouvertes.
      watch: { ignored: ['**/playwright-report/**', '**/test-results/**', '**/docs/**'] },
    },
    preview: { port: 4173, strictPort: true, proxy },
    build: { target: 'es2022', sourcemap: false },
    test: {
      environment: 'jsdom',
      // La moitié des cœurs : Go, Web et Mobile tournent souvent ensemble (et la CI a 2 vCPU).
      // Avec un worker par cœur chacun, la machine était trois fois surchargée et des tests
      // d'interface de moins de 2 s dépassaient leurs 5 s.
      maxWorkers: '50%',
      // Dernier recours, après les causes évitables (feuilles de style injectées : src/test/setup.ts).
      // Les parcours d'interface (connexion et 2FA, dialogues Radix, tableau) coûtent 0,3 à 1,6 s de
      // CPU seuls ; lancés avec Go (-race, un PostGIS par paquet) et Jest, la machine était 3 à 4 fois
      // surchargée (charge moyenne 21 sur 8 cœurs, sans swap) et ils mettaient 5 à 9 s. Les délais de
      // 5 s (test) et 1 s (attentes de Testing Library) servent à repérer un blocage, pas une machine
      // chargée : 15 s et 3 s le font toujours.
      testTimeout: 15_000,
      include: ['src/**/*.test.{ts,tsx}', 'build/**/*.test.ts'],
      setupFiles: ['src/test/setup.ts'],
      css: { include: [/globals\.css/] },
      restoreMocks: true,
      // openapi-fetch construit des Request absolues hors navigateur.
      env: { VITE_API_BASE_URL: 'http://api.test' },
    },
  }
})
