import { expect, type Locator, type Page, test } from '@playwright/test'

import { STORAGE_STATE } from '../playwright.config'
import { apiWrite, stationEtag } from './support/api'
import { fixtures } from './support/fixtures'
import { expectDashboard, fillCredentials } from './support/pages'

/**
 * Captures de référence (Web/docs/screenshots) de chaque écran, en clair et en sombre, à 1440 px
 * (et 1024 px pour les principaux). Les écrans 2FA utilisent les vrais composants mais des
 * réponses d'API simulées : secret TOTP et codes de secours de démonstration, jamais de vrais
 * secrets dans le dépôt. Le reste vient de la vraie API, sur la pile E2E (données de démo et
 * fixtures de scripts/e2e-stack.sh). Lancement : npm run screenshots
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

async function shoot(
  page: Page,
  name: string,
  opts: { fullPage?: boolean; reload?: () => Promise<void>; only1440?: boolean; settle?: () => Promise<void> } = {},
) {
  for (const size of opts.only1440 ? widths.slice(0, 1) : widths) {
    await page.setViewportSize(size)
    if (opts.reload) await opts.reload()
    for (const theme of themes) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await page.evaluate(() => document.fonts.ready)
      if (opts.settle) await opts.settle()
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
  await page.setViewportSize(widths[0])
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
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

test.describe('écrans connectés', () => {
  test.use({ storageState: STORAGE_STATE })

  test('tableau de bord', async ({ page }) => {
    await page.goto('/')
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

  test('stations : liste, fiche, justificatif, déplacement, correction en conflit', async ({ page }) => {
    const f = fixtures()
    await page.goto('/stations?status=all')
    await expect(page.getByRole('link', { name: f.pendingApprove.name })).toBeVisible()
    await shoot(page, 'stations', { reload: () => settleList(page, f.pendingApprove.name) })

    await page.goto(`/stations/${f.pendingReject.id}`)
    await expect(page.getByRole('heading', { level: 1, name: f.pendingReject.name })).toBeVisible()
    await shoot(page, 'station-pending', {
      fullPage: true,
      reload: async () => {
        await page.reload()
        await expect(page.getByRole('heading', { name: 'Historique' })).toBeVisible()
      },
    })

    await page.goto(`/stations/${f.pendingApprove.id}`)
    await page.getByRole('button', { name: 'Justificatif' }).click()
    await expect(page.getByRole('img', { name: /Page 1 sur/ })).toBeVisible({ timeout: 20_000 })
    await shoot(page, 'document-viewer', { only1440: true })
    await page.keyboard.press('Escape')

    await page.goto(`/stations/${f.move.id}`)
    await expect(page.getByRole('heading', { name: 'Demande de déplacement' })).toBeVisible()
    await shoot(page, 'station-move', { fullPage: true, only1440: true, settle: () => mapsIdle(page) })

    // Correction : quelqu'un d'autre modifie la station pendant la saisie → conflit 412.
    await page.goto(`/stations/${f.correct.id}`)
    await page.getByRole('button', { name: 'Corriger' }).click()
    const dialog = page.getByRole('dialog', { name: 'Corriger les informations' })
    await dialog.getByLabel('Adresse').fill('Boulevard de la Marina, face à l’aéroport')
    await dialog.getByLabel('Motif de la correction').fill('Adresse complétée après appel au gérant')
    const etag = await stationEtag(page, f.correct.id)
    await apiWrite(
      page,
      'PATCH',
      `/api/v1/admin/stations/${f.correct.id}`,
      { phone: `+2290197${String(Date.now()).slice(-6)}`, reason: 'Numéro corrigé (autre admin)' },
      etag,
    )
    await dialog.getByRole('button', { name: 'Enregistrer la correction' }).click()
    await expect(dialog.getByTestId('correction-conflict')).toBeVisible()
    await shoot(page, 'station-correction-conflict', { only1440: true })
  })

  test('cartes : stations regroupées et pénuries H3', async ({ page }) => {
    const f = fixtures()
    await page.goto(`/maps?station=${f.correct.id}`)
    await expect(page.getByRole('dialog', { name: f.correct.name })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Carte des stations' })).toBeVisible()
    await shoot(page, 'maps-stations', { settle: () => mapsIdle(page) })
    await page.keyboard.press('Escape')

    await page.goto('/maps?tab=shortages&period=30d')
    await expect(page.getByRole('region', { name: 'Carte des zones en pénurie' })).toBeVisible()
    await page.getByRole('listitem').getByRole('button').first().click()
    await expect(page.getByText('Zone en pénurie').or(page.getByText('Pas de pénurie')).first()).toBeVisible()
    await shoot(page, 'maps-shortages', { only1440: true, settle: () => mapsIdle(page) })
  })

  test('signalements, alertes, utilisateurs', async ({ page }) => {
    const f = fixtures()
    await page.goto(`/reports?report=${f.reportId}`)
    await expect(page.getByRole('dialog')).toBeVisible()
    await shoot(page, 'reports', { only1440: true })

    await page.goto('/alerts')
    await expect(page.getByRole('heading', { level: 1, name: 'Alertes' })).toBeVisible()
    await expect(page.getByRole('link', { name: f.excluded.name }).first()).toBeVisible()
    await shoot(page, 'alerts', { only1440: true })

    await page.goto(`/users?user=${f.user.id}`)
    await expect(page.getByRole('dialog', { name: f.user.name })).toBeVisible()
    await shoot(page, 'users', { only1440: true })
  })

  test('catalogue, audit, exports, palette', async ({ page }) => {
    const f = fixtures()
    await page.goto('/catalog')
    await expect(page.getByRole('list', { name: /Produits du catalogue/ })).toBeVisible()
    await shoot(page, 'catalog', { only1440: true })
    await page.getByRole('switch', { name: `Produit ${f.product.label} actif` }).click()
    await expect(page.getByRole('alertdialog')).toBeVisible()
    await shoot(page, 'catalog-deactivate', { only1440: true })
    await page.getByRole('button', { name: 'Annuler' }).click()

    await page.goto('/audit?action=admin.station_corrected')
    const first = page.getByRole('row').nth(1)
    await first.click()
    await expect(page.getByRole('heading', { name: 'Modifications' })).toBeVisible()
    await shoot(page, 'audit', { only1440: true })

    await apiWrite(page, 'POST', '/api/v1/admin/exports', { dataset: 'stations', format: 'csv' })
    await page.goto('/exports')
    await expect(page.getByText('Prêt').first()).toBeVisible({ timeout: 30_000 })
    await shoot(page, 'exports', { only1440: true })

    await page.goto('/')
    await expectDashboard(page)
    await page.keyboard.press('Control+k')
    await page.getByRole('combobox').fill('Station Ga')
    await expect(page.getByRole('option', { name: new RegExp(f.move.name) })).toBeVisible()
    await shoot(page, 'command-search', { only1440: true })
  })
})

async function settleList(page: Page, name: string) {
  await page.reload()
  await expect(page.getByRole('link', { name })).toBeVisible()
  await page.mouse.move(0, 0)
}

/** Laisse aux tuiles OpenFreeMap le temps d'arriver (canvas MapLibre). */
async function mapsIdle(page: Page) {
  const canvas: Locator = page.locator('.maplibregl-canvas').first()
  await expect(canvas).toBeVisible()
  await page.waitForLoadState('networkidle').catch(() => undefined)
  // Tuiles et milliers de polygones H3 traités par le worker de MapLibre avant le rendu.
  await page.waitForTimeout(4000)
}
