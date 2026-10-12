import createClient from 'openapi-fetch'
import type * as z from 'zod/mini'

import { ApiError } from './errors'
import type { components, paths } from './schema'
import { createSession } from './session'

export type Schemas = components['schemas']

/** Origine de l'API : vide en dev (proxy Vite, même origine) ; https://api.<domaine> en prod. */
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

let expiredHandler: () => void = () => {}
/** Branche la réaction à une session expirée (retour à la connexion), depuis le routeur. */
export function onSessionExpired(handler: () => void) {
  expiredHandler = handler
}

export const session = createSession({ baseUrl: API_BASE_URL, onExpired: () => expiredHandler() })

export const api = createClient<paths>({
  baseUrl: API_BASE_URL,
  credentials: 'include',
  headers: { Accept: 'application/json' },
  fetch: session.authFetch,
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
    if (import.meta.env.DEV) console.error('Réponse API non conforme', result.response.url, parsed.error)
    throw ApiError.invalidResponse(parsed.error)
  }
  return parsed.data as never
}
