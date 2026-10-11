import { expect, type Page, test } from '@playwright/test'

import { createAdmin } from './support/admin'
import { expectDashboard, fillCredentials } from './support/pages'
import { freshTotp } from './support/totp'

/**
 * Captures de référence (Web/docs/screenshots) : connexion, 2FA et tableau de bord, en clair et
 * en sombre, à 1440 et 1024 px. Les écrans 2FA utilisent les vrais composants mais des réponses
 * d'API simulées : secret TOTP et codes de secours de démonstration, jamais de vrais secrets dans
 * le dépôt. Le tableau de bord vient de la vraie API (données de make seed-dev).
 * Lancement : npm run screenshots
 */
const OUT = 'docs/screenshots'
const themes = ['light', 'dark'] as const
const widths = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const

const DEMO_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'
const DEMO_USER = {
  id: '01929b3e-7c41-7d2a-9f1e-3b8c2d4a5e6f',
  email: 'awa.houngbo@gostation.bj',
  firstName: 'Awa',
  lastName: 'Houngbo',
  role: 'admin',
  emailVerified: true,
  twoFactorEnabled: true,
  privacyPolicy: {
    acceptedVersion: '1.0',
    acceptedAt: '2026-10-01T08:00:00Z',
    currentVersion: '1.0',
    reacceptRequired: false,
  },
  station: null,
  createdAt: '2026-10-01T08:00:00Z',
}
const DEMO_CODES = [
  'K7QD-M2XA-PL4R-ZCWT',
  'B3HW-QENE-T5VY-GJ2K',
  'R6MZ-A4CF-X7LP-D3WB',
  'N2TE-JWGK-S5QH-VERA',
  'F4YC-L3PW-M7ZD-K2XN',
  'HEVA-R5BJ-Q2TE-W6LG',
  'D7KX-N3MF-Y4PC-BWQZ',
  'T5LG-W2RA-JEVE-H3MK',
  'PWZB-G6XD-C2KN-L7TW',
  'Y3QE-V7HM-R4FA-S2JD',
]

async function shoot(page: Page, name: string, opts: { fullPage?: boolean; reload?: () => Promise<void> } = {}) {
  for (const size of widths) {
    await page.setViewportSize(size)
    if (opts.reload) await opts.reload()
    for (const theme of themes) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.evaluate(() => document.fonts.ready)
      if (opts.fullPage) {
        // Page entière : la fenêtre prend la hauteur du document, pour que la barre latérale fixe
        // couvre toute la capture (une capture « fullPage » la couperait à la hauteur d'écran).
        const height = await page.evaluate(() => document.documentElement.scrollHeight)
        await page.setViewportSize({ width: size.width, height: Math.max(height, size.height) })
      }
      await page.screenshot({ path: `${OUT}/${name}-${theme}-${size.width}.png`, animations: 'disabled' })
      if (opts.fullPage) await page.setViewportSize(size)
    }
  }
}

async function mockChallenge(page: Page, twoFactor: 'setup_required' | 'required') {
  await page.route('**/api/v1/auth/admin/login', (route) =>
    route.fulfill({
      json: {
        mfaToken: 'gsm_demo',
        twoFactor,
        expiresIn: 300,
        ...(twoFactor === 'setup_required' && {
          setup: {
            secret: DEMO_SECRET,
            otpauthUri: `otpauth://totp/GoStation:awa.houngbo%40gostation.bj?secret=${DEMO_SECRET}&issuer=GoStation&algorithm=SHA1&digits=6&period=30`,
          },
        }),
      },
    }),
  )
}

test('connexion et 2FA (réponses simulées)', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible()
  await shoot(page, 'login')

  await mockChallenge(page, 'setup_required')
  await fillCredentials(page, { email: DEMO_USER.email, password: 'démonstration' })
  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible()
  await page.getByLabel('Code de vérification').pressSequentially('482')
  await shoot(page, '2fa-setup')

  await page.route('**/api/v1/auth/admin/2fa', (route) =>
    route.fulfill({ json: { user: DEMO_USER, csrfToken: 'demo', expiresIn: 900, recoveryCodes: DEMO_CODES } }),
  )
  await page.getByLabel('Code de vérification').pressSequentially('913')
  await expect(page.getByRole('heading', { name: 'Vos codes de secours' })).toBeVisible()
  await shoot(page, '2fa-codes')

  // Connexion suivante : code de l'application d'authentification. (Codes « sauvegardés » d'abord,
  // sinon l'avertissement beforeunload bloquerait la navigation.)
  await page.getByLabel("J'ai enregistré mes codes de secours en lieu sûr.").check()
  await page.unrouteAll()
  await page.evaluate(() => localStorage.clear())
  await mockChallenge(page, 'required')
  await page.goto('/login')
  await fillCredentials(page, { email: DEMO_USER.email, password: 'démonstration' })
  await expect(page.getByRole('heading', { name: 'Double authentification' })).toBeVisible()
  await shoot(page, '2fa-totp')
})

test('tableau de bord (vraie API, données de dev)', async ({ page }) => {
  const admin = createAdmin('Awa', 'Houngbo')
  await page.goto('/login')
  await fillCredentials(page, admin)
  const secret = ((await page.locator('code').getAttribute('title')) ?? '').replace(/\s/g, '')
  await page.getByLabel('Code de vérification').fill(freshTotp(secret).code)
  await page.getByLabel("J'ai enregistré mes codes de secours en lieu sûr.").check()
  await page.getByRole('button', { name: 'Accéder au tableau de bord' }).click()
  await expectDashboard(page)

  await shoot(page, 'dashboard', {
    fullPage: true,
    // Rechargement à chaque largeur : la barre latérale prend son état par défaut (rail sous 1280 px).
    reload: async () => {
      await page.reload()
      await expectDashboard(page)
      await expect(page.locator('.recharts-surface').first()).toBeVisible()
      await page.mouse.move(0, 0)
    },
  })
})
