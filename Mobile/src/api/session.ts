/**
 * Session du mobile : access token (15 min) en mémoire seulement, refresh token opaque dans
 * expo-secure-store (Keystore Android). Renouvellement en **single-flight** (règle 15) : un seul
 * POST /auth/refresh à la fois ; les requêtes en 401 attendent son résultat puis sont rejouées.
 * Deux refresh concurrents avec le même token seraient pris pour une réutilisation et
 * révoqueraient la session.
 */
import * as SecureStore from 'expo-secure-store'

import { type TokenPair, tokenPairSchema } from './schemas'

const REFRESH_KEY = 'gs.refresh-token'
/** Marge avant l'expiration : on renouvelle un peu avant, pour ne pas envoyer un jeton périmé. */
const EARLY_MS = 30_000

type Listener = (signedIn: boolean) => void

export interface SessionDeps {
  baseUrl: string
  fetch?: typeof fetch
  now?: () => number
  store?: Pick<typeof SecureStore, 'getItemAsync' | 'setItemAsync' | 'deleteItemAsync'>
  headers?: () => Record<string, string>
}

export function createSession(deps: SessionDeps) {
  const doFetch = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a))
  const now = deps.now ?? Date.now
  const store = deps.store ?? SecureStore
  let access: { token: string; expiresAt: number } | null = null
  let refreshToken: string | null = null
  let loaded = false
  let inflight: Promise<boolean> | null = null
  let lastRefreshAt = 0
  const listeners = new Set<Listener>()

  const emit = (signedIn: boolean) => listeners.forEach((l) => l(signedIn))

  /** Lit le refresh token au démarrage (une fois). */
  async function load(): Promise<boolean> {
    if (!loaded) {
      refreshToken = (await store.getItemAsync(REFRESH_KEY).catch(() => null)) ?? null
      loaded = true
    }
    return refreshToken !== null
  }

  async function save(pair: TokenPair) {
    access = { token: pair.accessToken, expiresAt: now() + pair.expiresIn * 1000 }
    refreshToken = pair.refreshToken
    loaded = true
    await store.setItemAsync(REFRESH_KEY, pair.refreshToken)
  }

  async function signIn(pair: TokenPair) {
    await save(pair)
    emit(true)
  }

  async function clear() {
    const had = refreshToken !== null || access !== null
    access = null
    refreshToken = null
    loaded = true
    await store.deleteItemAsync(REFRESH_KEY).catch(() => undefined)
    if (had) emit(false)
  }

  async function postRefresh(): Promise<boolean> {
    if (!(await load())) return false
    let res: Response
    try {
      res = await doFetch(`${deps.baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...deps.headers?.() },
        body: JSON.stringify({ refreshToken }),
      })
    } catch {
      // Réseau indisponible : la session reste (on réessaiera), mais pas de jeton frais.
      return false
    }
    if (res.status === 401 || res.status === 403) {
      await clear()
      return false
    }
    if (!res.ok) return false
    const parsed = tokenPairSchema.safeParse(await res.json().catch(() => null))
    if (!parsed.success) return false
    await save(parsed.data)
    lastRefreshAt = now()
    return true
  }

  /**
   * Renouvelle pour une requête envoyée à `sentAt` (0 : renouvellement proactif). Si un refresh a
   * abouti depuis l'envoi, rien à faire ; sinon on rejoint celui en cours ou on en lance un.
   */
  function refresh(sentAt = 0): Promise<boolean> {
    if (sentAt && lastRefreshAt > sentAt) return Promise.resolve(true)
    inflight ??= postRefresh().finally(() => {
      inflight = null
    })
    return inflight
  }

  /** Access token valide (renouvelé si besoin), ou null sans session. */
  async function accessToken(): Promise<string | null> {
    if (access && access.expiresAt - EARLY_MS > now()) return access.token
    if (!(await load())) return null
    await refresh()
    return access?.token ?? null
  }

  return {
    load,
    signIn,
    clear,
    refresh,
    accessToken,
    hasSession: () => refreshToken !== null,
    /** Refresh token courant (déconnexion : révoquer la session côté serveur). */
    currentRefreshToken: () => refreshToken,
    onChange(l: Listener) {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
  }
}

export type Session = ReturnType<typeof createSession>
