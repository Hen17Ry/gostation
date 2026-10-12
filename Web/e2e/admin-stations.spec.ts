import { expect, type Page, test } from '@playwright/test'

import { STORAGE_STATE } from '../playwright.config'
import { apiWrite, stationEtag } from './support/api'
import { fixtures } from './support/fixtures'

test.use({ storageState: STORAGE_STATE })

const toast = (page: Page, text: string) => page.getByRole('region', { name: /Notifications/ }).getByText(text)

test('approbation d’un dossier en attente', async ({ page }) => {
  const { pendingApprove: s } = fixtures()
  await page.goto('/stations')
  await expect(page.getByRole('radio', { name: /En attente/ })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('searchbox', { name: /Rechercher une station/ }).fill(s.ifu)
  await expect(page).toHaveURL(new RegExp(s.ifu)) // filtre dans l'URL (lien profond)
  await page.getByRole('link', { name: s.name }).click()

  await expect(page.getByRole('heading', { level: 1, name: s.name })).toBeVisible()
  await page.getByRole('button', { name: 'Approuver' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Approuver cette station ?' })
  await dialog.getByRole('button', { name: 'Approuver' }).click()
  await expect(toast(page, 'Station approuvée')).toBeVisible()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Approuvée', { exact: true }).first()).toBeVisible()
  // Historique (journal d'audit) : la décision y figure.
  await expect(page.getByRole('list', { name: 'Historique' }).getByText('Station approuvée')).toBeVisible()
})

test('rejet avec motif obligatoire', async ({ page }) => {
  const { pendingReject: s } = fixtures()
  await page.goto(`/stations/${s.id}`)
  await page.getByRole('button', { name: 'Rejeter' }).click()
  const dialog = page.getByRole('dialog', { name: 'Rejeter le dossier' })
  await dialog.getByRole('button', { name: 'Rejeter le dossier' }).click()
  await expect(dialog.getByText('Saisissez un motif (3 caractères au moins).')).toBeVisible()

  const reason = 'Justificatif illisible : merci de renvoyer une attestation IFU nette.'
  await dialog.getByLabel('Motif').fill(reason)
  await dialog.getByRole('button', { name: 'Rejeter le dossier' }).click()
  await expect(toast(page, 'Dossier rejeté')).toBeVisible()
  await expect(page.getByText('Refusée', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(reason).first()).toBeVisible()
})

test('demande de déplacement : carte avant / après puis validation', async ({ page }) => {
  const { move: s } = fixtures()
  await page.goto(`/stations/${s.id}`)
  const card = page
    .getByRole('heading', { name: 'Demande de déplacement' })
    .locator('xpath=ancestor::*[@data-slot="card"][1]')
  await expect(card.locator('dt', { hasText: 'Position actuelle' })).toBeVisible()
  await expect(card.locator('dt', { hasText: 'Position demandée' })).toBeVisible()
  await expect(card.getByRole('region', { name: /position actuelle et la position demandée/ })).toBeVisible()
  await expect(card.getByText(/1,2 km/).first()).toBeVisible()

  await card.getByRole('button', { name: 'Valider le déplacement' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Valider le déplacement' }).click()
  await expect(toast(page, 'Nouvelle position validée')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Demande de déplacement' })).toBeHidden()
  await expect(page.getByText(/6,37° N/).first()).toBeVisible()
})

test('correction : conflit 412, changements affichés, saisie conservée, rechargement', async ({ page }) => {
  const { correct: s } = fixtures()
  await page.goto(`/stations/${s.id}`)
  await page.getByRole('button', { name: 'Corriger' }).click()
  const dialog = page.getByRole('dialog', { name: 'Corriger les informations' })
  const address = 'Boulevard de la Marina, face à l’aéroport'
  await dialog.getByLabel('Adresse').fill(address)
  await dialog.getByLabel('Motif de la correction').fill('Adresse complétée après appel au gérant')

  // Un autre admin corrige le téléphone pendant la saisie.
  const phone = `+2290196${String(Date.now()).slice(-6)}`
  const other = await apiWrite(
    page,
    'PATCH',
    `/api/v1/admin/stations/${s.id}`,
    { phone, reason: 'Numéro corrigé par un autre admin' },
    await stationEtag(page, s.id),
  )
  expect(other.status).toBe(200)

  await dialog.getByRole('button', { name: 'Enregistrer la correction' }).click()
  const conflict = dialog.getByTestId('correction-conflict')
  await expect(conflict).toBeVisible()
  await expect(conflict.getByRole('row', { name: /Téléphone/ })).toContainText(phone)
  await expect(dialog.getByLabel('Adresse')).toHaveValue(address)

  await conflict.getByRole('button', { name: 'Recharger les données' }).click()
  await expect(conflict).toBeHidden()
  await expect(dialog.getByLabel('Adresse')).toHaveValue(address)
  await expect(dialog.getByLabel('Téléphone')).toHaveValue(phone)
  await dialog.getByRole('button', { name: 'Enregistrer la correction' }).click()
  await expect(toast(page, 'Informations corrigées')).toBeVisible()
  await expect(page.getByText(address).first()).toBeVisible()
})
