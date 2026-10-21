import { AxeBuilder } from '@axe-core/playwright'
import { expect, type Page, test } from '@playwright/test'

import { STORAGE_STATE } from '../playwright.config'
import { fixtures } from './support/fixtures'

/**
 * WCAG 2.2 AA (axe-core) sur chaque écran, en clair et en sombre. Les tuiles de carte (canvas
 * MapLibre) sont exclues : leur alternative est la liste des stations et le tableau des cellules.
 */
test.use({ storageState: STORAGE_STATE })

/**
 * Les mêmes parcours vérifient la CSP de production (servie par `vite preview`, comme par Caddy) :
 * aucune violation sur un écran, une carte (workers MapLibre, tuiles OpenFreeMap) ou le
 * justificatif (pdf.js, URL objet).
 */
const cspViolations = new WeakMap<Page, string[]>()
test.beforeEach(async ({ page }) => {
  const seen: string[] = []
  cspViolations.set(page, seen)
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) seen.push(m.text())
  })
  await page.exposeFunction('__cspViolation', (v: string) => seen.push(v))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      const report = (window as unknown as { __cspViolation: (v: string) => void }).__cspViolation
      void report(`${e.violatedDirective} ${e.blockedURI}`)
    })
  })
})
test.afterEach(({ page }) => {
  expect(cspViolations.get(page), 'violations de la CSP').toEqual([])
})

async function audit(page: Page, label: string) {
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .exclude('.maplibregl-canvas-container')
      .analyze()
    const summary = violations.map(
      (v) => `${v.id} (${v.impact}) : ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    )
    expect(summary, `${label} (${theme})`).toEqual([])
  }
}

test('écrans d’administration sans violation WCAG 2.2 AA', async ({ page }) => {
  const f = fixtures()
  const screens: Array<[string, string, () => Promise<void>]> = [
    ['/stations?status=all', 'stations', () => expect(page.getByRole('link', { name: f.correct.name })).toBeVisible()],
    [
      `/stations/${f.move.id}`,
      'fiche station',
      () => expect(page.getByRole('heading', { name: 'Historique' })).toBeVisible(),
    ],
    ['/maps', 'carte des stations', () => expect(page.locator('.maplibregl-canvas')).toBeVisible()],
    [
      '/maps?tab=shortages',
      'carte des pénuries',
      () => expect(page.getByText(/Cliquez une cellule|Aucune cellule/)).toBeVisible(),
    ],
    [
      `/reports?report=${f.reportId}`,
      'signalements',
      async () => {
        // Ouvert, ou déjà traité si le scénario de modération est passé avant.
        const open = await page
          .getByRole('dialog')
          .waitFor({ state: 'visible', timeout: 3_000 })
          .then(() => true)
          .catch(() => false)
        if (!open) await page.goto(`/reports?status=resolved&report=${f.reportId}`)
        await expect(page.getByRole('dialog')).toBeVisible()
      },
    ],
    ['/alerts', 'alertes', () => expect(page.getByRole('table')).toBeVisible()],
    [
      `/users?user=${f.user.id}`,
      'utilisateurs',
      () => expect(page.getByRole('dialog', { name: f.user.name })).toBeVisible(),
    ],
    ['/catalog', 'catalogue', () => expect(page.getByRole('list', { name: /Produits du catalogue/ })).toBeVisible()],
    ['/audit', 'audit', () => expect(page.getByRole('table')).toBeVisible()],
    ['/exports', 'exports', () => expect(page.getByRole('button', { name: 'Lancer l’export' })).toBeVisible()],
  ]
  for (const [url, label, ready] of screens) {
    await page.goto(url)
    await ready()
    await audit(page, label)
  }
})

test('dialogues sans violation WCAG 2.2 AA', async ({ page }) => {
  const f = fixtures()
  await page.goto(`/stations/${f.move.id}`)
  await page.getByRole('button', { name: 'Corriger' }).click()
  await expect(page.getByRole('dialog', { name: 'Corriger les informations' })).toBeVisible()
  await audit(page, 'correction')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Justificatif' }).click()
  await expect(page.getByRole('img', { name: /Page 1 sur/ })).toBeVisible({ timeout: 20_000 })
  await audit(page, 'justificatif')
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Suspendre' }).click()
  await expect(page.getByRole('dialog', { name: 'Suspendre la station' })).toBeVisible()
  await audit(page, 'motif')
  await page.keyboard.press('Escape')

  await page.goto('/catalog')
  await page.getByRole('button', { name: 'Nouveau produit' }).click()
  await expect(page.getByRole('dialog', { name: 'Nouveau produit' })).toBeVisible()
  await audit(page, 'nouveau produit')
  await page.keyboard.press('Escape')

  await page.keyboard.press('Control+k')
  await page.getByRole('combobox').fill('Station')
  await expect(page.getByRole('option').first()).toBeVisible()
  await audit(page, 'palette')
})
