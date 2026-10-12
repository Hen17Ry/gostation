import { readFile } from 'node:fs/promises'

import { expect, test } from '@playwright/test'

import { createAdmin, type TestAdmin } from './support/admin'
import { expectDashboard, fillCredentials, signOut } from './support/pages'
import { freshTotp } from './support/totp'

// Un même admin traverse les scénarios, dans l'ordre : mise en place de la 2FA, code de secours,
// session expirée. Trois connexions seulement (5 par minute et par IP).
test.describe.configure({ mode: 'serial' })

let admin: TestAdmin
let secret = ''
let recoveryCodes: string[] = []
let lastStep: number | undefined

test.beforeAll(() => {
  admin = createAdmin()
})

test('premier login : mise en place de la 2FA, codes de secours, tableau de bord, déconnexion', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login\?redirect=%2F/)
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()

  await fillCredentials(page, admin)
  await expect(page.getByRole('heading', { name: 'Activer la double authentification' })).toBeVisible()
  await expect(page.getByRole('img', { name: /QR code de configuration/ })).toBeVisible()
  secret = ((await page.locator('code').getAttribute('title')) ?? '').replace(/\s/g, '')
  expect(secret).toMatch(/^[A-Z2-7]{16,}$/)

  const { code, step } = freshTotp(secret)
  lastStep = step
  await page.getByLabel('Code de vérification').fill(code)

  await expect(page.getByRole('heading', { name: 'Vos codes de secours' })).toBeVisible()
  recoveryCodes = await page.getByTestId('recovery-codes').locator('li span.select-all').allTextContents()
  expect(recoveryCodes).toHaveLength(10)
  for (const c of recoveryCodes) expect(c).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/)

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Télécharger (.txt)' }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe('gostation-codes-de-secours.txt')
  const text = await readFile((await file.path())!, 'utf8')
  for (const c of recoveryCodes) expect(text).toContain(c)

  const go = page.getByRole('button', { name: 'Accéder au tableau de bord' })
  await expect(go).toBeDisabled()
  await page.getByLabel("J'ai enregistré mes codes de secours en lieu sûr.").check()
  await go.click()

  await expect(page).toHaveURL(/\/$/)
  await expectDashboard(page)
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible()

  await signOut(page)
  // Session révoquée : l'espace admin renvoie à la connexion.
  await page.goto('/')
  await expect(page).toHaveURL(/\/login\?redirect=%2F/)
})

test('connexion avec un code de secours', async ({ page }) => {
  await page.goto('/login')
  await fillCredentials(page, admin)
  await expect(page.getByRole('heading', { name: 'Double authentification' })).toBeVisible()
  await page.getByRole('button', { name: 'Utiliser un code de secours' }).click()
  await page.getByLabel('Code de secours').fill(recoveryCodes[0]!.toLowerCase().replace(/-/g, ' '))
  await page.getByRole('button', { name: 'Vérifier' }).click()
  await expectDashboard(page)
  await signOut(page)
})

test('lien profond, tableau de bord, puis session expirée : retour à la connexion en gardant la page', async ({
  page,
  context,
}) => {
  await page.goto('/?period=30d')
  await expect(page).toHaveURL(/\/login\?redirect=%2F%3Fperiod%3D30d/)
  await fillCredentials(page, admin)
  const { code, step } = freshTotp(secret, lastStep)
  lastStep = step
  await page.getByLabel('Code de vérification').fill(code)

  // Retour à la page demandée, période comprise.
  await expect(page).toHaveURL(/\/\?period=30d$/)
  await expectDashboard(page)
  await expect(page.getByRole('radio', { name: '30 derniers jours' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('heading', { name: 'Zones en pénurie' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Fraîcheur des stocks' })).toBeVisible()

  // Période 24 h depuis le sélecteur : l'URL suit.
  await page.getByRole('radio', { name: 'Dernières 24 heures' }).click()
  await expect(page).toHaveURL(/period=24h/)

  // Palette ⌘K : navigation au clavier.
  await page.keyboard.press('Control+k')
  await page.getByRole('combobox').fill('Signal')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/reports$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Signalements' })).toBeVisible()

  // Expiration : plus de cookies de session ; la page demandée est conservée.
  await context.clearCookies()
  await page.goto('/?period=7d')
  await expect(page).toHaveURL(/\/login\?redirect=%2F%3Fperiod%3D7d/)
  await expect(page.getByText('Votre session a expiré')).toBeVisible()
})
