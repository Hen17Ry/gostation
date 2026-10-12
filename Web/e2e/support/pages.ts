import { expect, type Page } from '@playwright/test'

import type { TestAdmin } from './admin'

export async function fillCredentials(page: Page, admin: Pick<TestAdmin, 'email' | 'password'>) {
  await page.getByLabel('Adresse email').fill(admin.email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(admin.password)
  await page.getByRole('button', { name: 'Continuer' }).click()
}

export async function expectDashboard(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: 'Tableau de bord' })).toBeVisible()
  await expect(page.getByText('Recherches', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Recherches par produit' })).toBeVisible()
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Compte administrateur' }).click()
  await page.getByRole('menuitem', { name: 'Se déconnecter' }).click()
  await expect(page).toHaveURL(/\/login\?reason=signed-out/)
  await expect(page.getByText('Vous êtes déconnecté.')).toBeVisible()
}
