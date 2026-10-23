import AxeBuilder from '@axe-core/playwright'

import { expect, motionMode, test } from './fixtures'

test.describe('Ouverture', () => {
  test('mode complet : croquis, bouteille 3D (ou repli léger mesuré), bandeau', async ({ page, watch }) => {
    void watch
    const threeRequests: string[] = []
    page.on('request', (r) => r.url().includes('opening-bottle') && threeRequests.push(r.url()))
    await page.goto('/?mode=full')
    await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(
      "Le gaz, l'essence, le gasoil. Là où il y en a.",
    )
    // Sans GPU (CI), SwiftShader compile les shaders sur le fil principal : l'intro peut prendre du retard.
    await expect(page.locator('[data-band]')).toBeInViewport({ timeout: 12_000 })
    // Après le remplissage : la 3D tourne, ou le site est passé en léger (WebGL lent ou absent).
    await expect
      .poll(
        async () => {
          const html = await page.evaluate(() => ({ ...document.documentElement.dataset }))
          const canvasShown = await page.locator('[data-webgl]').isVisible()
          return (html.motion === 'full' && canvasShown) || (html.motion === 'lite' && !!html.degraded)
        },
        { timeout: 15_000 },
      )
      .toBe(true)
    expect(threeRequests.length).toBe(1)
  })

  test('mode léger : jamais de Three.js, bouteille 2D', async ({ page, watch }) => {
    void watch
    const threeRequests: string[] = []
    page.on('request', (r) => r.url().includes('opening-bottle') && threeRequests.push(r.url()))
    await page.goto('/?mode=lite')
    expect(await motionMode(page)).toBe('lite')
    await expect(page.locator('[data-bottle-solid]')).toBeVisible({ timeout: 8000 })
    await expect(page.locator('[data-webgl]')).toBeHidden()
    expect(threeRequests).toEqual([])
  })

  test('prefers-reduced-motion : état final, sans épinglage ni défilement automatique', async ({ page, watch }) => {
    void watch
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')
    expect(await motionMode(page)).toBe('reduced')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('[data-bottle-solid]')).toBeVisible()
    await expect(page.locator('[data-bottle-sketch]')).toBeHidden()
    expect(await page.locator('.pin-spacer').count()).toBe(0)
    await expect(page.locator('[data-motion-toggle]')).toBeHidden()
    const x = () => page.locator('[data-marquee-track]').evaluate((el) => getComputedStyle(el).transform)
    const before = await x()
    await page.waitForTimeout(600)
    expect(await x()).toBe(before)
  })

  test('sans JavaScript : toute l’histoire est lisible', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false })
    const page = await context.newPage()
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByText('GoStation vous montre la station la plus proche')).toBeVisible()
    await expect(page.locator('[data-bottle-solid]')).toBeVisible()
    await expect(page.getByText('Gaz 5 kg, 10 kg et 25 kg, essence, gasoil : en stock près de vous.')).toBeAttached()
    for (const h of ['La bouteille est vide.', 'Choisissez. GoStation cherche.', 'Vos stocks à jour en un geste.']) {
      await expect(page.getByRole('heading', { name: h })).toBeVisible()
    }
    await context.close()
  })

  test('bouton Pause : arrête la dérive du bandeau (WCAG 2.2.2)', async ({ page, watch }) => {
    void watch
    await page.goto('/?mode=lite')
    const toggle = page.locator('[data-motion-toggle]')
    await expect(toggle).toHaveAccessibleName('Mettre les animations en pause')
    await page.waitForTimeout(2000)
    await toggle.click()
    await expect(toggle).toHaveAccessibleName('Reprendre les animations')
    await page.waitForTimeout(800)
    const x = () =>
      page.locator('[data-marquee-track]').evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41)
    const before = await x()
    await page.waitForTimeout(700)
    expect(Math.abs((await x()) - before)).toBeLessThan(1)
  })

  test('accessibilité (axe, WCAG 2.2 AA) : réduit et animé', async ({ page }) => {
    for (const mode of ['reduced', 'full']) {
      await page.goto(`/?mode=${mode}`)
      await page.waitForTimeout(mode === 'full' ? 4500 : 300)
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(results.violations.map((v) => `${mode} ${v.id}: ${v.nodes.length}`)).toEqual([])
    }
  })
})
