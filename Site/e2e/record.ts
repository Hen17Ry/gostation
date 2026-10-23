/**
 * Vidéos et captures du parcours complet (docs/landing/), jamais en CI : npm run record.
 * Ordinateur : crans de molette envoyés dans la page (Lenis les lisse), comme un visiteur. Mobile :
 * défilement natif progressif (le doigt). Chromium emploie le GPU de la machine (ANGLE) : la 3D
 * tourne comme chez un visiteur ; la page indique le mode réellement joué (data-motion).
 * Vidéos (.webm) hors du dépôt ; captures dans docs/landing/captures/.
 */
import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { test, type Page } from '@playwright/test'

const out = fileURLToPath(new URL('../../docs/landing/', import.meta.url))
const captures = `${out}captures/`
const tmp = fileURLToPath(new URL('../test-results/videos/', import.meta.url))

type Target = {
  name: 'ordinateur' | 'mobile'
  viewport: { width: number; height: number }
  scale: number
  mobile: boolean
}

const targets: Target[] = [
  { name: 'ordinateur', viewport: { width: 1440, height: 900 }, scale: 1, mobile: false },
  { name: 'mobile', viewport: { width: 390, height: 844 }, scale: 2, mobile: true },
]

/** Points de passage : scène, avancement (de l'épinglage, ou de la hauteur), durée, capture. */
const WAYPOINTS: [scene: string, fraction: number, ms: number, label?: string][] = [
  ['opening', 0.45, 2200, '04-rotation'],
  ['opening', 0.97, 2000, '05-l-orange-envahit'],
  ['problem', 0.04, 1800, '06-le-titre-sur-l-orange'],
  ['problem', 0.2, 2000, '07-la-nuit-tombe'],
  ['problem', 0.62, 3200, '08-ruptures'],
  ['problem', 1, 2200, '09-au-hasard'],
  ['solution', 0.25, 2800, '10-le-telephone'],
  ['solution', 0.72, 3600, '11-l-onde-a-2-km'],
  ['solution', 1, 2000, '12-les-resultats'],
  ['route', 0.5, 3200, '13-l-itineraire'],
  ['route', 1, 2800, '14-l-arrivee'],
  ['managers', 0.14, 2000, '15-le-telephone-pivote'],
  ['managers', 0.32, 1800, '16-le-rappel'],
  ['managers', 0.72, 2800, '17-rien-n-a-change'],
  ['companies', 0.35, 3000, '18-les-compagnies'],
  ['final', 0.14, 2600, '19-le-volet'],
  ['final', 0.42, 2400, '20-lettre-par-lettre'],
  ['final', 0.74, 2600, '21-zoom-arriere'],
  ['final', 1, 2200, '22-le-benin-vu-de-l-espace'],
  ['questions', 0.35, 2600, '23-questions'],
  ['end', 1, 2200, '24-pied-de-page'],
]

test.describe.configure({ mode: 'serial' })
test.beforeAll(() => mkdirSync(captures, { recursive: true }))

/** Position (px) d'un point de passage. */
const positionOf = (page: Page, scene: string, fraction: number) =>
  page.evaluate(
    ([scene, fraction]) => {
      if (scene === 'end') return document.documentElement.scrollHeight - innerHeight
      const el = document.querySelector(`[data-scene="${scene}"]`)!
      const spacer = (el.closest('.pin-spacer') ?? el) as HTMLElement
      const top = spacer.getBoundingClientRect().top + scrollY
      const length = Math.max(innerHeight, spacer.offsetHeight - innerHeight)
      return top + Number(fraction) * length
    },
    [scene, fraction] as const,
  )

/** Défilement jusqu'à `to` px en `ms`, à la molette (ordinateur) ou au doigt (mobile). */
async function scrollTo(page: Page, target: Target, to: number, ms: number) {
  if (!target.mobile) {
    await page.evaluate(
      ([to, ms]) =>
        new Promise<void>((done) => {
          const steps = Math.max(1, Math.round(ms / 40))
          const delta = (to - window.scrollY) / steps
          let i = 0
          const id = setInterval(() => {
            window.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true, cancelable: true }))
            if (++i >= steps) {
              clearInterval(id)
              done()
            }
          }, 40)
        }),
      [to, ms] as const,
    )
    await page.waitForTimeout(900)
    return
  }
  await page.evaluate(
    ([to, ms]) =>
      new Promise<void>((done) => {
        const from = window.scrollY
        const start = performance.now()
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / ms)
          const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
          window.scrollTo(0, from + (to - from) * e)
          if (t < 1) requestAnimationFrame(step)
          else done()
        }
        requestAnimationFrame(step)
      }),
    [to, ms] as const,
  )
  await page.waitForTimeout(900)
}

for (const target of targets) {
  test(`parcours — ${target.name}`, async ({ browser }) => {
    test.setTimeout(240_000)
    rmSync(tmp, { recursive: true, force: true })
    const size = { width: target.viewport.width * target.scale, height: target.viewport.height * target.scale }
    const context = await browser.newContext({
      viewport: target.viewport,
      deviceScaleFactor: target.scale,
      isMobile: target.mobile,
      hasTouch: target.mobile,
      colorScheme: 'light',
      recordVideo: { dir: tmp, size },
    })
    const page = await context.newPage()
    const shot = (label: string) => page.screenshot({ path: `${captures}${target.name}-${label}.png` })

    await page.goto('/?mode=full')
    await page.mouse.move(target.viewport.width - 4, target.viewport.height / 2)
    await page.waitForTimeout(900)
    await shot('01-croquis')
    await page.waitForTimeout(1300)
    await shot('02-remplissage')
    await page.waitForTimeout(2200)
    await shot('03-bouteille-3d')

    for (const [scene, fraction, ms, label] of WAYPOINTS) {
      await scrollTo(page, target, await positionOf(page, scene, fraction), ms)
      if (label) await shot(label)
    }
    await page.waitForTimeout(600)

    const mode = await page.evaluate(() => ({ ...document.documentElement.dataset }))
    console.log(`${target.name} : mode ${mode.motion}, ${mode.fps ?? '?'} images/s mesurées`)
    const video = page.video()
    await context.close()
    if (video) renameSync(await video.path(), `${out}parcours-${target.name}.webm`)
  })
}

test('captures des autres modes (léger, réduit, sombre)', async ({ browser }) => {
  test.setTimeout(240_000)
  for (const [label, url, scheme, reduced] of [
    ['leger', '/?mode=lite', 'light', false],
    ['reduit', '/', 'light', true],
    ['sombre', '/?mode=full', 'dark', false],
  ] as const) {
    for (const target of targets) {
      const context = await browser.newContext({
        viewport: target.viewport,
        deviceScaleFactor: target.scale,
        isMobile: target.mobile,
        hasTouch: target.mobile,
        colorScheme: scheme,
        reducedMotion: reduced ? 'reduce' : 'no-preference',
      })
      const page = await context.newPage()
      await page.goto(url)
      await page.waitForTimeout(reduced ? 600 : 4500)
      await page.screenshot({ path: `${captures}${target.name}-${label}.png` })
      if (!reduced) {
        for (const [scene, fraction, name] of [
          ['solution', 0.75, 'recherche'],
          ['final', 0.98, 'espace'],
        ] as const) {
          await page.evaluate((y) => window.scrollTo(0, y), await positionOf(page, scene, fraction))
          await page.waitForTimeout(1800)
          await page.screenshot({ path: `${captures}${target.name}-${label}-${name}.png` })
        }
      }
      await context.close()
    }
  }
})
