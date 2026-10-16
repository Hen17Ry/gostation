import { expect, type Page, test } from '@playwright/test'

import { STORAGE_STATE } from '../playwright.config'
import { fixtures } from './support/fixtures'

test.use({ storageState: STORAGE_STATE })

const toast = (page: Page, text: string) => page.getByRole('region', { name: /Notifications/ }).getByText(text)

test('demande de données faite depuis l’app : prise en charge puis clôture avec réponse', async ({ page }) => {
  const { dataRequest, lateRequest } = fixtures()
  await page.goto('/data-requests')
  await expect(page.getByRole('heading', { name: 'Demandes de données', level: 1 })).toBeVisible()
  // Alerte d'échéance : une demande des fixtures est en retard.
  await expect(page.getByRole('alert').filter({ hasText: /en retard/ })).toBeVisible()
  await expect(
    page.getByRole('row').filter({ hasText: lateRequest.reference }).getByText('En retard', { exact: true }),
  ).toBeVisible()

  await page
    .getByRole('row')
    .filter({ hasText: dataRequest.reference })
    .getByRole('button', { name: 'Rectification', exact: true })
    .click()
  await expect(page).toHaveURL(new RegExp(`request=${dataRequest.id}`))
  const panel = page.getByRole('dialog', { name: 'Rectification' })
  await expect(panel.getByText("Mon prénom s'écrit Séna, avec un accent.")).toBeVisible()
  await expect(panel.getByText(/Demande faite depuis l’application/)).toBeVisible()
  await expect(panel.getByText(dataRequest.email)).toBeVisible()

  await panel.getByRole('button', { name: 'Prendre en charge' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Prendre en charge' })
  await confirm.getByRole('button', { name: 'Prendre en charge' }).click()
  await expect(toast(page, 'Demande prise en charge')).toBeVisible()
  await expect(panel.getByText('En cours', { exact: true }).first()).toBeVisible()

  await panel.getByRole('button', { name: 'Clore avec une réponse' }).click()
  const dialog = page.getByRole('dialog', { name: 'Clore la demande' })
  await dialog.getByRole('button', { name: 'Clore avec une réponse' }).click()
  await expect(dialog.getByText('Saisissez un motif (3 caractères au moins).')).toBeVisible()
  await dialog.getByLabel('Réponse').fill('Votre prénom a été corrigé dans votre profil.')
  await dialog.getByRole('button', { name: 'Clore avec une réponse' }).click()
  await expect(toast(page, 'Demande close')).toBeVisible()
  await expect(panel.getByText('Traitée', { exact: true }).first()).toBeVisible()
  await expect(panel.getByText('Votre prénom a été corrigé dans votre profil.')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Clore avec une réponse' })).toHaveCount(0)

  // Filtre « En retard » : seulement les demandes ouvertes échues.
  await page.goto('/data-requests?overdue=true')
  await expect(page.getByRole('row').filter({ hasText: lateRequest.reference })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: dataRequest.reference })).toHaveCount(0)
})

test('demande reçue par email : rien n’est traité avant le code de confirmation', async ({ page }) => {
  const { dataRequest } = fixtures()
  await page.goto('/data-requests')
  await page.getByRole('button', { name: 'Demande reçue par email' }).click()
  const dialog = page.getByRole('dialog', { name: 'Enregistrer une demande reçue par email' })
  await dialog.getByLabel('Adresse email du compte').fill('personne.inconnue@example.bj')
  await dialog.getByRole('button', { name: 'Enregistrer et envoyer le code' }).click()
  await expect(dialog.getByText('Aucun compte n’utilise cette adresse email.')).toBeVisible()

  await dialog.getByLabel('Adresse email du compte').fill(dataRequest.email)
  await dialog.getByLabel('Type de demande').click()
  await page.getByRole('option', { name: 'Opposition' }).click()
  await dialog.getByRole('button', { name: 'Enregistrer et envoyer le code' }).click()
  await expect(toast(page, 'Demande enregistrée')).toBeVisible()

  const panel = page.getByRole('dialog', { name: 'Opposition' })
  await expect(panel.getByText('Identité à confirmer').first()).toBeVisible()
  await expect(panel.getByText(/Un code a été envoyé à l’adresse du compte/)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Prendre en charge' })).toHaveCount(0)
  await panel.getByLabel('Code reçu par la personne').fill('12')
  await panel.getByRole('button', { name: 'Vérifier le code' }).click()
  await expect(panel.getByText('Saisissez les 6 chiffres du code.')).toBeVisible()
})
