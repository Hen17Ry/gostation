/**
 * Session de l'admin web : cookies httpOnly posés par l'API, jeton CSRF recopié dans
 * X-CSRF-Token sur toute écriture, et renouvellement des tokens en **single-flight** (règle 15) :
 * un seul POST /auth/refresh à la fois, y compris entre onglets (Web Locks), les requêtes en 401
 * attendent son résultat puis sont rejouées. Deux refresh concurrents avec le même token seraient
 * pris pour une réutilisation et révoqueraient la session.
 *
 * Jeton CSRF : cookie gs_csrf s'il est lisible (même origine), sinon copie en mémoire (reçue au
 * login ou au refresh), sinon GET /auth/csrf (après un rechargement de page, ou quand l'API est
 * sur un autre hôte, D43). Il n'est jamais écrit dans le stockage du navigateur ; seul un
 * indicateur non secret « session ouverte » l'est, pour distinguer une session expirée d'une
 * première visite.
 */
const SIGNED_IN_KEY = 'gs-signed-in'
const REFRESHED_AT_KEY = 'gs-refreshed-at'
const LOCK_NAME = 'gs-auth-refresh'
const CSRF_COOKIE = 'gs_csrf'

/** Routes d'auth qui ne déclenchent jamais de refresh sur un 401. */
const NO_REFRESH_PATHS = [
  '/api/v1/auth/admin/login',
  '/api/v1/auth/admin/2fa',
  '/api/v1/auth/refresh',
  '/api/v1/auth/logout',
  '/api/v1/auth/csrf',
]
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export type RefreshOutcome = 'refreshed' | 'expired'

export interface SessionOptions {
  /** Origine de l'API ('' = même origine, via le proxy Vite en dev). */
  baseUrl: string
  fetch?: typeof fetch
  /** Appelé une fois quand une session existante ne peut plus être renouvelée. */
  onExpired?: () => void
  now?: () => number
  locks?: Pick<LockManager, 'request'> | null
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  readCookie?: () => string
}

export function createSession(opts: SessionOptions) {
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args))
  const now = opts.now ?? Date.now
  const storage = opts.storage === undefined ? safeLocalStorage() : opts.storage
  const locks =
    opts.locks === undefined ? (typeof navigator !== 'undefined' ? (navigator.locks ?? null) : null) : opts.locks
  const readCookie = opts.readCookie ?? (() => (typeof document === 'undefined' ? '' : document.cookie))

  let csrfMemory: string | null = null
  let csrfInflight: Promise<string | null> | null = null
  let lastRefreshAt = 0
  let inflight: Promise<RefreshOutcome> | null = null
  let expiredNotified = false
  let expiredFlag = false

  function store(key: string, value: string | null) {
    try {
      if (value === null) storage?.removeItem(key)
      else storage?.setItem(key, value)
    } catch {
      // Stockage indisponible : la mémoire suffit pour l'onglet courant.
    }
  }
  function load(key: string): string | null {
    try {
      return storage?.getItem(key) ?? null
    } catch {
      return null
    }
  }

  /** Jeton CSRF connu sans requête : cookie lisible (même origine), sinon copie en mémoire. */
  function getCsrfToken(): string | null {
    const m = readCookie().match(new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]+)`))
    if (m?.[1]) return decodeURIComponent(m[1])
    return csrfMemory
  }

  /** Jeton CSRF, récupéré auprès de l'API s'il n'est pas connu (une seule requête à la fois). */
  function ensureCsrf(): Promise<string | null> {
    const known = getCsrfToken()
    if (known) return Promise.resolve(known)
    csrfInflight ??= doFetch(`${opts.baseUrl}/api/v1/auth/csrf`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
      .then(async (res) => {
        if (!res.ok) return null
        const body = (await res.json().catch(() => null)) as { csrfToken?: unknown } | null
        return typeof body?.csrfToken === 'string' ? body.csrfToken : null
      })
      .then((token) => {
        if (token) csrfMemory = token
        return token
      })
      .finally(() => {
        csrfInflight = null
      })
    return csrfInflight
  }

  /** Session ouverte (login ou refresh réussi) : jeton en mémoire, indicateur partagé. */
  function setCsrfToken(token: string | null) {
    csrfMemory = token
    if (token) {
      store(SIGNED_IN_KEY, '1')
      expiredNotified = false
    }
  }

  /** Fin de session côté client (logout, expiration) : plus de jeton, plus de refresh. */
  function clear() {
    csrfMemory = null
    store(SIGNED_IN_KEY, null)
    store(REFRESHED_AT_KEY, null)
  }

  /** Une session a été ouverte dans ce navigateur (et pas encore close). */
  const hasSession = () => getCsrfToken() !== null || load(SIGNED_IN_KEY) === '1'
  const refreshedAt = () => Math.max(lastRefreshAt, Number(load(REFRESHED_AT_KEY)) || 0)

  function expire() {
    clear()
    expiredFlag = true
    if (!expiredNotified) {
      expiredNotified = true
      opts.onExpired?.()
    }
  }

  async function postRefresh(sentAt: number): Promise<RefreshOutcome> {
    // Un autre onglet a pu renouveler la session pendant l'attente du verrou.
    if (refreshedAt() > sentAt) return 'refreshed'
    const csrf = await ensureCsrf()
    if (!csrf) return 'expired'
    const res = await doFetch(`${opts.baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': csrf, Accept: 'application/json' },
    })
    if (!res.ok) return 'expired'
    const body = (await res.json().catch(() => null)) as { csrfToken?: unknown } | null
    if (typeof body?.csrfToken === 'string') setCsrfToken(body.csrfToken)
    lastRefreshAt = now()
    store(REFRESHED_AT_KEY, String(lastRefreshAt))
    return 'refreshed'
  }

  /**
   * Renouvelle la session pour une requête envoyée à `sentAt` et refusée en 401. Si un refresh a
   * abouti depuis l'envoi, rien à faire : on rejoue. Sinon on rejoint le refresh en cours, ou on
   * en lance un (sous verrou inter-onglets).
   */
  function refresh(sentAt: number): Promise<RefreshOutcome> {
    if (refreshedAt() > sentAt) return Promise.resolve('refreshed')
    inflight ??= (locks ? locks.request(LOCK_NAME, () => postRefresh(sentAt)) : postRefresh(sentAt)).finally(() => {
      inflight = null
    })
    return inflight
  }

  async function withCsrf(request: Request) {
    if (SAFE_METHODS.has(request.method)) return
    const csrf = await ensureCsrf()
    if (csrf) request.headers.set('X-CSRF-Token', csrf)
  }

  /** fetch authentifié, passé à openapi-fetch. */
  async function authFetch(request: Request): Promise<Response> {
    const sentAt = now()
    const replay = request.clone()
    const path = new URL(request.url, 'http://local').pathname
    if (!NO_REFRESH_PATHS.includes(path)) await withCsrf(request)
    const res = await doFetch(request)
    if (res.status !== 401) {
      // Jeton refusé (session changée entre-temps) : on oublie la copie, la prochaine écriture le relit.
      if (res.status === 403 && !SAFE_METHODS.has(request.method)) {
        const body = (await res
          .clone()
          .json()
          .catch(() => null)) as { code?: unknown } | null
        if (body?.code === 'auth.csrf_failed') csrfMemory = null
      }
      return res
    }
    if (NO_REFRESH_PATHS.includes(path) || !hasSession()) return res

    if ((await refresh(sentAt)) === 'expired') {
      expire()
      return res
    }
    await withCsrf(replay)
    const second = await doFetch(replay)
    if (second.status === 401) expire()
    return second
  }

  /** Vrai une fois si la dernière session vient d'expirer (message « session expirée »). */
  function consumeExpired(): boolean {
    const v = expiredFlag
    expiredFlag = false
    return v
  }

  return { authFetch, refresh, ensureCsrf, getCsrfToken, setCsrfToken, clear, hasSession, consumeExpired }
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export type Session = ReturnType<typeof createSession>
