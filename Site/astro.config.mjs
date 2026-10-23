// Site public gostation.bj : statique (Astro), îlots React seulement pour l'interactif.
import react from '@astrojs/react'
import sitemap from '@astrojs/sitemap'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL || 'https://gostation.bj',
  output: 'static',
  trailingSlash: 'never',
  // Pages en fichiers (cgu.html) : Caddy sert /cgu par try_files {path}.html, comme aujourd'hui.
  build: { format: 'file', assets: 'assets', inlineStylesheets: 'auto' },
  integrations: [react(), sitemap()],
  devToolbar: { enabled: false },
  prefetch: false,
  server: { host: '127.0.0.1', port: 4321 },
  vite: {
    plugins: [tailwindcss()],
    // Rien en data: (CSP stricte) : polices et scripts en fichiers.
    build: { assetsInlineLimit: 0 },
  },
})
