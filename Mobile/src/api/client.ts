import Constants from 'expo-constants'
import * as Device from 'expo-device'
import createClient from 'openapi-fetch'
import { Platform } from 'react-native'
import type * as z from 'zod/mini'

import { installId } from '@/lib/install-id'

import { ApiError } from './errors'
import type { paths } from './schema'
import { createSession } from './session'

/** URL de l'API (EXPO_PUBLIC_API_URL ; en dev sur téléphone : adb reverse tcp:8080 tcp:8080). */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '')

/**
 * Identité lisible de l'app pour la liste « Appareils connectés » (sinon : « okhttp/4.x ») :
 * « GoStation/0.1.0 (Android 12; SM-G973F) ». Version du système (`Device.osVersion`), pas le
 * niveau d'API que donne `Platform.Version` sur Android (31 pour Android 12).
 */
export function userAgent(appVersion: string, os: string, osVersion: string | null, model: string | null) {
  return `GoStation/${appVersion} (${os === 'ios' ? 'iOS' : 'Android'} ${osVersion ?? '?'}; ${model ?? 'appareil'})`
}
const USER_AGENT = userAgent(Constants.expoConfig?.version ?? '0', Platform.OS, Device.osVersion, Device.modelName)

/** En-têtes de toutes les requêtes : installation (quotas, appareil push), langue, app. */
const baseHeaders = () => ({ 'X-Install-Id': installId(), 'Accept-Language': 'fr', 'User-Agent': USER_AGENT })

export const session = createSession({ baseUrl: API_URL, headers: baseHeaders })

/**
 * fetch authentifié passé à openapi-fetch : jeton Bearer s'il y a une session, rejeu unique après
 * un refresh (single-flight) si l'API répond 401.
 */
async function authFetch(request: Request): Promise<Response> {
  const sentAt = Date.now()
  const replay = request.clone()
  const token = await session.accessToken()
  for (const [k, v] of Object.entries(baseHeaders())) request.headers.set(k, v)
  if (token) request.headers.set('Authorization', `Bearer ${token}`)
  const res = await fetch(request)
  if (res.status !== 401 || !token) return res
  if (!(await session.refresh(sentAt))) return res
  const fresh = await session.accessToken()
  for (const [k, v] of Object.entries(baseHeaders())) replay.headers.set(k, v)
  if (fresh) replay.headers.set('Authorization', `Bearer ${fresh}`)
  return fetch(replay)
}

/**
 * Envoi multipart (justificatif) : `fetch` reçoit directement le FormData. React Native ne lit un
 * fichier désigné par son URI que sous cette forme (pas au travers d'un objet Request, ni d'un
 * clone). Même jeton et même rejeu après un refresh que `authFetch`.
 */
export async function sendMultipart(path: string, form: FormData, headers: Record<string, string> = {}) {
  const send = async () => {
    const token = await session.accessToken()
    return fetch(`${API_URL}${path}`, {
      method: 'POST',
      body: form,
      headers: {
        ...baseHeaders(),
        Accept: 'application/json',
        ...headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    })
  }
  const sentAt = Date.now()
  const res = await send()
  if (res.status !== 401 || !(await session.accessToken())) return res
  if (!(await session.refresh(sentAt))) return res
  return send()
}

export const api = createClient<paths>({
  baseUrl: API_URL,
  headers: { Accept: 'application/json' },
  fetch: authFetch,
})

type FetchResult<T> = { data?: T; error?: unknown; response: Response }

/**
 * Attend une réponse openapi-fetch : renvoie les données (validées par zod si un schéma est
 * donné), ou lève une ApiError (problem+json, réseau, réponse non conforme).
 */
export async function unwrap<T, S extends z.ZodMiniType = z.ZodMiniType<T>>(
  pending: Promise<FetchResult<T>>,
  schema?: S,
): Promise<S extends z.ZodMiniType<infer O> ? O : T> {
  let result: FetchResult<T>
  try {
    result = await pending
  } catch (e) {
    throw e instanceof ApiError ? e : ApiError.network(e)
  }
  if (!result.response.ok) throw ApiError.fromResponse(result.response, result.error)
  if (!schema) return result.data as never
  const parsed = schema.safeParse(result.data)
  if (!parsed.success) {
    if (__DEV__) console.warn('Réponse API non conforme', result.response.url, parsed.error)
    throw ApiError.invalidResponse(parsed.error)
  }
  return parsed.data as never
}
