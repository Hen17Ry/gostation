import type { Page } from '@playwright/test'

/** Origine de l'API : le proxy de `vite preview` en local (chemins relatifs), l'API publique en staging. */
const API_ORIGIN = process.env.E2E_TARGET === 'staging' ? (process.env.E2E_API_URL ?? 'https://api.gostation.bj') : ''

/**
 * Appel de l'API avec la session admin de la page (cookies du contexte) : jeton CSRF lu sur
 * GET /auth/csrf, comme le client après un rechargement. Sert à simuler une autre personne qui
 * modifie une ressource pendant le scénario (conflit 412).
 */
export async function apiWrite(
  page: Page,
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
  ifMatch?: string,
): Promise<{ status: number; json: unknown }> {
  const csrf = await page.request.get(`${API_ORIGIN}/api/v1/auth/csrf`)
  const { csrfToken } = (await csrf.json()) as { csrfToken: string }
  const res = await page.request.fetch(`${API_ORIGIN}${path}`, {
    method,
    data: body,
    headers: { 'X-CSRF-Token': csrfToken, ...(ifMatch ? { 'If-Match': ifMatch } : {}) },
  })
  return { status: res.status(), json: await res.json().catch(() => null) }
}

/** Version courante d'une station (ETag "v{version}"). */
export async function stationEtag(page: Page, id: string): Promise<string> {
  const res = await page.request.get(`${API_ORIGIN}/api/v1/admin/stations/${id}`)
  const { version } = (await res.json()) as { version: number }
  return `"v${version}"`
}
