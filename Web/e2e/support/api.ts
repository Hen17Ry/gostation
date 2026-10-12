import type { Page } from '@playwright/test'

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
  const csrf = await page.request.get('/api/v1/auth/csrf')
  const { csrfToken } = (await csrf.json()) as { csrfToken: string }
  const res = await page.request.fetch(path, {
    method,
    data: body,
    headers: { 'X-CSRF-Token': csrfToken, ...(ifMatch ? { 'If-Match': ifMatch } : {}) },
  })
  return { status: res.status(), json: await res.json().catch(() => null) }
}

/** Version courante d'une station (ETag "v{version}"). */
export async function stationEtag(page: Page, id: string): Promise<string> {
  const res = await page.request.get(`/api/v1/admin/stations/${id}`)
  const { version } = (await res.json()) as { version: number }
  return `"v${version}"`
}
