// Banc des écrans du téléphone (scripts/gen-screens.mjs) : peint chaque état demandé et l'expose.
import './fonts.css'

import { createScreenCanvas, loadMap, paint, type Screen } from '@/lib/phone/painter'

declare global {
  interface Window {
    renderScreens: (screens: Screen[]) => Promise<string[]>
  }
}

window.renderScreens = async (screens) => {
  await Promise.all([
    loadMap(),
    document.fonts.load('600 16px "Geist"'),
    document.fonts.load('800 24px "Bricolage Grotesque"'),
  ])
  return screens.map((s) => {
    const canvas = createScreenCanvas()
    paint(canvas, s)
    document.body.append(canvas)
    return canvas.toDataURL('image/webp', 0.86)
  })
}
