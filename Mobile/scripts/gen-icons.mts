/**
 * Génère les images de l'app depuis les SVG de assets/brand/ : icône (1024), icône adaptative
 * Android (avant-plan + monochrome), image de l'écran de démarrage, icône de notification.
 * Usage : npm run gen:icons.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Resvg } from '@resvg/resvg-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const brand = (f: string) => join(root, 'assets', 'brand', f)
const out = (f: string) => join(root, 'assets', 'images', f)

const jobs: [source: string, target: string, size: number][] = [
  ['icon.svg', 'icon.png', 1024],
  ['adaptive-foreground.svg', 'android-icon-foreground.png', 1024],
  ['adaptive-monochrome.svg', 'android-icon-monochrome.png', 1024],
  ['logo.svg', 'splash-icon.png', 1024],
  // Notification Android (24 dp à xxxhdpi) : silhouette blanche, le plugin expo-notifications en
  // dérive les densités.
  ['notification.svg', 'notification-icon.png', 96],
]

for (const [source, target, size] of jobs) {
  const png = new Resvg(readFileSync(brand(source)), { fitTo: { mode: 'width', value: size } }).render().asPng()
  writeFileSync(out(target), png)
  console.log(`${target} ${size}px (${Math.round(png.length / 1024)} Ko)`)
}
