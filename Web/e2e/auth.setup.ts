import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { expect, test as setup } from '@playwright/test'

import { STORAGE_STATE } from '../playwright.config'
import { createAdmin } from './support/admin'
import { expectDashboard, fillCredentials } from './support/pages'
import { freshTotp } from './support/totp'

/** Connexion unique (2FA comprise) partagée par les scénarios d'administration. */
setup('session admin', async ({ page }) => {
  const admin = createAdmin('Sena', 'Agossou')
  await page.goto('/login')
  await fillCredentials(page, admin)
  await expect(page.getByRole('heading', { name: 'Activer la double authentification' })).toBeVisible()
  const secret = ((await page.locator('code').getAttribute('title')) ?? '').replace(/\s/g, '')
  await page.getByLabel('Code de vérification').fill(freshTotp(secret).code)
  await expect(page.getByRole('heading', { name: 'Vos codes de secours' })).toBeVisible()
  await page.getByLabel("J'ai enregistré mes codes de secours en lieu sûr.").check()
  await page.getByRole('button', { name: 'Accéder au tableau de bord' }).click()
  await expectDashboard(page)
  mkdirSync(dirname(STORAGE_STATE), { recursive: true })
  await page.context().storageState({ path: STORAGE_STATE })
  writeFileSync(`${dirname(STORAGE_STATE)}/admin-name.txt`, `${admin.firstName} ${admin.lastName}`)
})
