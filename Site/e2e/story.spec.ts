import AxeBuilder from '@axe-core/playwright'

import { expect, test } from './fixtures'

/** Défile jusqu'à `fraction` de l'épinglage de la scène `scene` (ou de sa hauteur sans épinglage). */
async function scrollToScene(page: import('@playwright/test').Page, scene: string, fraction: number) {
  await page.evaluate(
    ([scene, fraction]) => {
      const el = document.querySelector(`[data-scene="${scene}"]`)!
      const spacer = el.closest('.pin-spacer') ?? el
      const top = spacer.getBoundingClientRect().top + scrollY
      const length = Math.max(innerHeight, (spacer as HTMLElement).offsetHeight - innerHeight)
      window.scrollTo(0, top + Number(fraction) * length)
    },
    [scene, fraction] as const,
  )
  await page.waitForTimeout(1600)
}

test.describe('Le parcours', () => {
  for (const mode of ['lite', 'full'] as const) {
    test(`toutes les scènes, sans erreur ni violation de CSP (${mode})`, async ({ page, watch }) => {
      void watch
      test.setTimeout(120_000)
      await page.goto(`/?mode=${mode}`)
      await page.waitForTimeout(3500)
      const tone = () => page.locator('[data-site-header]').getAttribute('data-tone')
      expect(await tone()).toBe('page')

      // Scène 1 → 2 : l'orange couvre, la barre prend la teinte de l'orange.
      await scrollToScene(page, 'opening', 0.98)
      await expect.poll(tone).toBe('brand')

      // Scène 2 : la nuit tombe, le trajet erre et les ruptures se posent.
      await scrollToScene(page, 'problem', 0.75)
      await expect.poll(tone).toBe('night')
      await expect(page.locator('[data-city] [data-wander-path]')).toBeVisible()
      await expect(page.locator('[data-city] [data-stop-tag]').first()).toBeVisible()

      // Scène 3 : l'onde s'élargit jusqu'à 2 km, les stations en stock s'allument.
      await scrollToScene(page, 'solution', 0.9)
      await expect(page.locator('[data-city] [data-ring="2000"]')).toBeVisible()
      await expect(page.locator('[data-city] .station.is-stock .station-rank')).toHaveCount(3)

      // Scène 4 : le tracé et le zémidjan ; à l'arrivée, le badge.
      await scrollToScene(page, 'route', 0.95)
      await expect(page.locator('[data-city] [data-badge]')).toBeVisible()

      // Scène 7 : GOSTATION en entier, puis les actions sur l'espace.
      await scrollToScene(page, 'final', 0.99)
      await expect(page.locator('[data-scene="final"]').getByRole('heading', { name: 'GoStation' })).toBeVisible()
      await expect(page.locator('[data-final-cta]').getByRole('link', { name: "Télécharger l'app" })).toBeVisible()
      await expect.poll(tone).toBe('night')

      // Scène 8 : les questions, sur le fond de page.
      await scrollToScene(page, 'questions', 0.3)
      await expect.poll(tone).toBe('page')
    })
  }

  test('accessibilité (axe, WCAG 2.2 AA) de chaque scène animée', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/?mode=lite')
    await page.waitForTimeout(3000)
    // La scène affichée seulement (et l'en-tête) : les sections hors écran, transparentes sur le
    // décor fixe, n'ont pas encore leur fond.
    const axe = (scene: string) =>
      new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .include(`[data-scene="${scene}"]`)
        .include('[data-site-header]')
        .analyze()
    for (const [scene, f] of [
      ['problem', 0.6],
      ['solution', 0.9],
      ['route', 0.9],
      ['managers', 0.9],
      ['companies', 0.2],
      ['final', 0.99],
      ['questions', 0.2],
    ] as const) {
      await scrollToScene(page, scene, f)
      const results = await axe(scene)
      expect(results.violations.map((v) => `${scene} ${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([])
    }
  })
})
