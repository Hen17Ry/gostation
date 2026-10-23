/**
 * Vidéos et captures du parcours (docs/landing/), jamais en CI : npm run record.
 * Ordinateur : molette (lissée par Lenis), comme un visiteur. Mobile : défilement natif progressif
 * (le doigt), Lenis ne lisse pas le tactile. Chromium emploie le GPU de la machine (ANGLE) : la
 * 3D tourne comme chez un visiteur ; la page indique le mode réellement joué (data-motion).
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

test.describe.configure({ mode: 'serial' })
test.beforeAll(() => mkdirSync(captures, { recursive: true }))

/** Défilement jusqu'à `to` px en `ms`, à la molette (ordinateur) ou au doigt (mobile). */
async function scrollTo(page: Page, target: Target, to: number, ms: number) {
  if (!target.mobile) {
    // Crans de molette à cadence régulière, envoyés dans la page (mouse.wheel de Playwright attend
    // l'accusé de chaque événement et ralentit l'enregistrement) ; Lenis les lisse.
    await page.evaluate(
      ([to, ms]) =>
        new Promise<void>((done) => {
          const steps = Math.max(1, Math.round(ms / 50))
          const delta = (to - window.scrollY) / steps
          let i = 0
          const id = setInterval(() => {
            window.dispatchEvent(new WheelEvent('wheel', { deltaY: delta, bubbles: true, cancelable: true }))
            if (++i >= steps) {
              clearInterval(id)
              done()
            }
          }, 50)
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
  await page.waitForTimeout(500)
}

for (const target of targets) {
  test(`ouverture — ${target.name}`, async ({ browser }) => {
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
    await shot('1-croquis')
    await page.waitForTimeout(1300)
    await shot('2-remplissage')
    await page.waitForTimeout(2300)
    await shot('3-bouteille-3d')

    const vh = target.viewport.height
    const pin = vh * (target.mobile ? 1 : 1.2)
    await scrollTo(page, target, pin * 0.3, 1800)
    await shot('4-rotation')
    await scrollTo(page, target, pin * 0.78, 2200)
    await shot('5-le-bandeau-inonde')
    await scrollTo(page, target, pin + vh * 0.9, 2400)
    await shot('6-vers-la-nuit')
    await page.waitForTimeout(800)

    const mode = await page.evaluate(() => ({ ...document.documentElement.dataset }))
    console.log(`${target.name} : mode ${mode.motion}, ${mode.fps ?? '?'} images/s mesurées`)
    const video = page.video()
    await context.close()
    if (video) renameSync(await video.path(), `${out}ouverture-${target.name}.webm`)
  })
}

test('captures des autres modes (léger, réduit, sombre)', async ({ browser }) => {
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
      await context.close()
    }
  }
})
