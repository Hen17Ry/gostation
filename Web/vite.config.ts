/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

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
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['src/test/setup.ts'],
      css: { include: [/globals\.css/] },
      restoreMocks: true,
      // openapi-fetch construit des Request absolues hors navigateur.
      env: { VITE_API_BASE_URL: 'http://api.test' },
    },
  }
})
