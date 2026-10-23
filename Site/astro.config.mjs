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
    // Un seul tsconfig pour tout ce qui est transformé, y compris l'analyseur des textes légaux
    // importé de Mobile/ (dont le tsconfig étend expo/tsconfig.base, absent sans les dépendances
    // de l'app, en CI et dans l'image du proxy).
    tsconfig: './tsconfig.json',
    // Rien en data: (CSP stricte) : polices et scripts en fichiers.
    build: { assetsInlineLimit: 0 },
    // Sources hors du site : textes légaux (docs/legal), analyseur de l'app, tokens du web.
    server: { fs: { allow: ['..'] } },
  },
})
