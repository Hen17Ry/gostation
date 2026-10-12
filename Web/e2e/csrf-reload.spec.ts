import { expect, test } from '@playwright/test'

import { createAdmin } from './support/admin'
import { expectDashboard, fillCredentials } from './support/pages'
import { freshTotp } from './support/totp'

// Après un rechargement, le jeton CSRF n'est plus en mémoire : le client le redemande à
// GET /auth/csrf avant la première écriture (régression de l'étape 8A).
test('connexion, rechargement, puis écriture réussie (jeton CSRF récupéré)', async ({ page, context }) => {
  const admin = createAdmin('Kossi', 'Dossou')
  await page.goto('/login')
  await fillCredentials(page, admin)
  const secret = ((await page.locator('code').getAttribute('title')) ?? '').replace(/\s/g, '')
  await page.getByLabel('Code de vérification').fill(freshTotp(secret).code)
  await page.getByLabel("J'ai enregistré mes codes de secours en lieu sûr.").check()
  await page.getByRole('button', { name: 'Accéder au tableau de bord' }).click()
  await expectDashboard(page)

  // Production : l'API est sur un autre hôte, son cookie gs_csrf est illisible pour l'admin. On
  // le retire pour reproduire ce cas (l'API ne le lit pas : le jeton est lié à la session).
  await context.clearCookies({ name: 'gs_csrf' })
  await page.goto('/exports')
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Exports' })).toBeVisible()
  // Le jeton n'est jamais écrit dans le stockage du navigateur.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))
  expect(stored).not.toMatch(/csrf/i)

  const csrf = page.waitForResponse((r) => r.url().endsWith('/api/v1/auth/csrf'))
  const write = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/admin/exports') && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Lancer l’export' }).click()
  expect((await csrf).status()).toBe(200)
  expect((await write).status()).toBe(202)
  await expect(page.getByRole('region', { name: /Notifications/ }).getByText('Export lancé')).toBeVisible()
})
