import { expect, test } from '@playwright/test'

import { STORAGE_STATE } from '../playwright.config'

test.use({ storageState: STORAGE_STATE })

// Régression : dans un build de production, MapLibre 6 cherchait son worker à côté de son propre
// module (introuvable une fois bundlé) et la carte des pénuries restait vide.
test('la carte des pénuries du tableau de bord se charge (worker MapLibre)', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/?period=30d')
  await page.getByRole('button', { name: 'Afficher la carte' }).click()
  await expect(page.getByRole('region', { name: 'Carte des zones en pénurie' }).locator('canvas')).toBeVisible()
  // Les workers démarrent avec les premières tuiles : leur échec arrive après le premier rendu.
  await page.waitForLoadState('networkidle')
  await page.waitForTimeout(3_000)
  expect(errors.filter((e) => /worker/i.test(e))).toEqual([])
})
