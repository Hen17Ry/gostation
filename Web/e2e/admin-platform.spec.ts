import { readFile } from 'node:fs/promises'

import { expect, type Page, test } from '@playwright/test'

import { STORAGE_STATE } from '../playwright.config'
import { fixtures } from './support/fixtures'

test.use({ storageState: STORAGE_STATE })

const toast = (page: Page, text: string) => page.getByRole('region', { name: /Notifications/ }).getByText(text)

test('désactivation d’un produit : dialogue d’impact', async ({ page }) => {
  const { product } = fixtures()
  await page.goto('/catalog')
  const toggle = page.getByRole('switch', { name: `Produit ${product.label} actif` })
  await expect(toggle).toBeChecked()
  await toggle.click()
  const dialog = page.getByRole('alertdialog', { name: `Désactiver « ${product.label} » ?` })
  await expect(dialog).toContainText(`${product.stations} stations vendent ce produit.`)
  // Focus initial sur « Annuler » : une action destructive se confirme explicitement.
  await expect(dialog.getByRole('button', { name: 'Annuler' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Désactiver' }).click()
  await expect(toast(page, 'Produit désactivé')).toBeVisible()
  await expect(toggle).not.toBeChecked()
})

test('export CSV : création, suivi du statut, téléchargement', async ({ page }) => {
  await page.goto('/exports')
  await page.getByRole('combobox', { name: 'Jeu de données' }).click()
  await page.getByRole('option', { name: 'Signalements' }).click()
  await page.getByRole('radio', { name: 'CSV' }).click()
  await page.getByRole('button', { name: 'Lancer l’export' }).click()
  await expect(toast(page, 'Export lancé')).toBeVisible()

  const row = page.getByRole('row').filter({ hasText: 'Signalements' }).first()
  await expect(row.getByText('Prêt')).toBeVisible({ timeout: 30_000 })
  const download = page.waitForEvent('download')
  await row.getByRole('button', { name: /Télécharger/ }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/\.csv$/)
  const text = await readFile((await file.path())!, 'utf8')
  expect(text.split('\n')[0]).toContain('reason')
  expect(text).not.toMatch(/@example\.bj/) // jamais d'email dans un export
  await expect(toast(page, 'Téléchargement lancé')).toBeVisible()
})

test('palette ⌘K : recherche d’une station par IFU', async ({ page }) => {
  const { excluded } = fixtures()
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible()
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox').fill(excluded.ifu.slice(0, 8))
  await page.getByRole('option', { name: new RegExp(excluded.name) }).click()
  await expect(page).toHaveURL(new RegExp(`/stations/${excluded.id}`))
  await expect(page.getByRole('heading', { level: 1, name: excluded.name })).toBeVisible()
})

test('catalogue : réordonnancement au clavier (glisser-déposer accessible)', async ({ page }) => {
  await page.goto('/catalog')
  const list = page.getByRole('list', { name: /Produits du catalogue/ })
  const labels = () => list.getByRole('listitem').locator('span.truncate.font-medium').allTextContents()
  await expect(list.getByRole('listitem').first()).toBeVisible()
  const before = await labels()
  expect(before.length).toBeGreaterThan(2)

  const handle = page.getByRole('button', { name: `Déplacer ${before[0]}` })
  await handle.focus()
  await page.keyboard.press('Space')
  await expect(page.getByText(new RegExp(`${before[0]} saisi, position 1 sur`))).toBeAttached()
  // Le capteur clavier de dnd-kit n'écoute les flèches qu'au tour suivant, zones de dépôt mesurées :
  // une flèche envoyée trop tôt est perdue et l'élément redéposé à sa place (vu sur le staging).
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.keyboard.press('ArrowDown')
  await expect(page.getByText(`${before[0]} : position 2 sur ${before.length}.`)).toBeAttached()
  await page.keyboard.press('Space')
  await expect(page.getByRole('region', { name: /Notifications/ }).getByText('Ordre enregistré')).toBeVisible()
  await expect.poll(labels).toEqual([before[1], before[0], ...before.slice(2)])

  // Ordre persistant (relu depuis l'API), puis remis en place avec le bouton « Monter ».
  await page.reload()
  await expect.poll(labels).toEqual([before[1], before[0], ...before.slice(2)])
  await list.getByRole('listitem').nth(1).getByRole('button', { name: 'Monter' }).click()
  await expect.poll(labels).toEqual(before)
})
