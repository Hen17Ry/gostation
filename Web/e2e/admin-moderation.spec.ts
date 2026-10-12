import { expect, type Page, test } from '@playwright/test'

import { STORAGE_STATE } from '../playwright.config'
import { fixtures } from './support/fixtures'

test.use({ storageState: STORAGE_STATE })

const toast = (page: Page, text: string) => page.getByRole('region', { name: /Notifications/ }).getByText(text)

test('traitement d’un signalement, retrait puis rétablissement du droit de signaler', async ({ page }) => {
  const { reportId, reported } = fixtures()
  await page.goto('/reports')
  await page
    .getByRole('row')
    .filter({ hasText: reported.name })
    .getByRole('button', { name: 'Autre', exact: true })
    .click()
  await expect(page).toHaveURL(new RegExp(`report=${reportId}`))
  const panel = page.getByRole('dialog', { name: 'Autre' })
  await expect(panel.getByText('Le gérant refuse de vendre le gaz 12,5 kg')).toBeVisible()

  // Droit de signaler : retrait (motif obligatoire) puis rétablissement.
  await panel.getByRole('button', { name: 'Retirer le droit de signaler' }).click()
  let dialog = page.getByRole('dialog', { name: 'Retirer le droit de signaler' })
  await dialog.getByLabel('Motif').fill('Signalements répétés sans fondement')
  await dialog.getByRole('button', { name: 'Retirer le droit de signaler' }).click()
  await expect(toast(page, 'Droit de signaler retiré')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Rétablir le droit de signaler' })).toBeVisible()
  await panel.getByRole('button', { name: 'Rétablir le droit de signaler' }).click()
  dialog = page.getByRole('dialog', { name: 'Rétablir le droit de signaler' })
  await dialog.getByLabel('Motif').fill('Erreur de modération')
  await dialog.getByRole('button', { name: 'Rétablir le droit de signaler' }).click()
  await expect(toast(page, 'Droit de signaler rétabli')).toBeVisible()

  // Traitement avec une note interne.
  await panel.getByRole('button', { name: 'Marquer comme traité' }).click()
  dialog = page.getByRole('dialog', { name: 'Marquer ce signalement comme traité ?' })
  await dialog.getByLabel(/Note interne/).fill('Gérant rappelé, vente rétablie')
  await dialog.getByRole('button', { name: 'Marquer comme traité' }).click()
  await expect(toast(page, 'Signalement traité')).toBeVisible()
  await expect(panel.getByText('Traité', { exact: true }).first()).toBeVisible()
  await expect(panel.getByText('Gérant rappelé, vente rétablie')).toBeVisible()
})

test('désactivation d’un utilisateur avec motif', async ({ page }) => {
  const { user } = fixtures()
  await page.goto('/users')
  await page.getByRole('searchbox', { name: /Rechercher un compte/ }).fill(user.email)
  await page
    .getByRole('row')
    .filter({ hasText: user.email })
    .getByRole('button', { name: user.name, exact: true })
    .click()
  const panel = page.getByRole('dialog', { name: user.name })
  await expect(panel.getByText('Actif', { exact: true })).toBeVisible()

  await panel.getByRole('button', { name: 'Désactiver le compte' }).click()
  const dialog = page.getByRole('dialog', { name: 'Désactiver ce compte ?' })
  await dialog.getByLabel('Motif').fill('Usurpation signalée par la personne')
  await dialog.getByRole('button', { name: 'Désactiver le compte' }).click()
  await expect(toast(page, 'Compte désactivé')).toBeVisible()
  await expect(panel.getByText('Désactivé', { exact: true })).toBeVisible()
  await expect(panel.getByText('Usurpation signalée par la personne')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Réactiver le compte' })).toBeVisible()
})
