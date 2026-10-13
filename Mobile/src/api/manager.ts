import { type QueryClient, queryOptions } from '@tanstack/react-query'
import { File } from 'expo-file-system'
import type * as z from 'zod/mini'

import { api, sendMultipart, session } from './client'
import { ApiError } from './errors'
import { managerKeys } from './keys'
import {
  closureSchema,
  managerReportPageSchema,
  managerStationSchema,
  muteResponseSchema,
  openingHoursSchema,
  sessionResponseSchema,
  setLocationResponseSchema,
  stationProductListSchema,
  stockListSchema,
} from './schemas'
import type { components } from './schema'

type Schemas = components['schemas']

/**
 * Espace gérant (D58 à D64). Toute ressource de la station porte un `ETag` (`"v{version}"`) :
 * chaque lecture le garde avec ses données, chaque écriture l'envoie en `If-Match` et renvoie le
 * nouveau. 412 `resource.version_conflict` : la station a changé entre-temps (recharger, rejouer).
 */
export interface Versioned<T> {
  data: T
  etag: string
}

type FetchResult<T> = { data?: T; error?: unknown; response: Response }

/** Comme `unwrap`, avec l'ETag de la réponse (versions des ressources de la station). */
async function unwrapVersioned<S extends z.ZodMiniType>(
  pending: Promise<FetchResult<unknown>>,
  schema: S,
): Promise<Versioned<z.infer<S>>> {
  let result: FetchResult<unknown>
  try {
    result = await pending
  } catch (e) {
    throw e instanceof ApiError ? e : ApiError.network(e)
  }
  if (!result.response.ok) throw ApiError.fromResponse(result.response, result.error)
  const parsed = schema.safeParse(result.data)
  if (!parsed.success) {
    if (__DEV__) console.warn('Réponse API non conforme', result.response.url, parsed.error)
    throw ApiError.invalidResponse(parsed.error)
  }
  return { data: parsed.data, etag: result.response.headers.get('ETag') ?? '' }
}

/** ETag seul (réponses 204). */
async function unwrapEtag(pending: Promise<FetchResult<unknown>>): Promise<string> {
  let result: FetchResult<unknown>
  try {
    result = await pending
  } catch (e) {
    throw e instanceof ApiError ? e : ApiError.network(e)
  }
  if (!result.response.ok) throw ApiError.fromResponse(result.response, result.error)
  return result.response.headers.get('ETag') ?? ''
}

const ifMatch = (etag: string) => ({ header: { 'If-Match': etag } })

/** Réponse d'un envoi multipart → données validées et ETag (mêmes règles que `unwrapVersioned`). */
async function multipart<S extends z.ZodMiniType>(
  path: string,
  form: FormData,
  schema: S,
  headers?: Record<string, string>,
) {
  let res: Response
  try {
    res = await sendMultipart(path, form, headers)
  } catch (e) {
    throw ApiError.network(e)
  }
  const body: unknown = await res.json().catch(() => undefined)
  return unwrapVersioned(
    Promise.resolve({ data: res.ok ? body : undefined, error: res.ok ? undefined : body, response: res }),
    schema,
  )
}

export const isVersionConflict = (e: unknown) => e instanceof ApiError && e.code === 'resource.version_conflict'

/**
 * Après une écriture, la version de la station a changé : les autres lectures de l'espace gérant
 * (et leur ETag) sont périmées et rechargées au prochain affichage.
 */
export const invalidateOtherVersions = (qc: QueryClient, written: readonly unknown[]) =>
  qc.invalidateQueries({ queryKey: managerKeys.all, predicate: (q) => q.queryKey[1] !== written[1] })

// --- Inscription ------------------------------------------------------------------------------

/** Justificatif à envoyer : fichier local (photo réduite ou fichier choisi), jamais conservé après. */
export interface DocumentFile {
  uri: string
  name: string
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png'
  size: number
}

/**
 * Partie fichier du formulaire : le `File` d'expo-file-system (un Blob), seul format accepté par
 * le fetch d'Expo (l'objet `{ uri, name, type }` de React Native y est refusé).
 */
const filePart = (f: DocumentFile) => new File(f.uri) as unknown as Blob

export type ManagerRegistrationFields = Omit<Schemas['ManagerRegistration'], 'document' | 'privacyPolicyVersion'>

export async function registerManager(fields: ManagerRegistrationFields, document: DocumentFile, policy: string) {
  const form = new FormData()
  for (const [k, v] of Object.entries({ ...fields, privacyPolicyVersion: policy })) {
    if (typeof v === 'string' && v.trim() !== '') form.append(k, v.trim())
  }
  form.append('document', filePart(document))
  const res = await multipart('/api/v1/auth/register/manager', form, sessionResponseSchema)
  await session.signIn(res.data)
  return res.data.user
}

// --- Station ----------------------------------------------------------------------------------

export const managerStationQuery = queryOptions({
  queryKey: managerKeys.station(),
  queryFn: ({ signal }) => unwrapVersioned(api.GET('/api/v1/manager/station', { signal }), managerStationSchema),
})

export const updateStation = (body: Schemas['UpdateStationRequest'], etag: string) =>
  unwrapVersioned(api.PATCH('/api/v1/manager/station', { params: ifMatch(etag), body }), managerStationSchema)

export function resubmitDocument(document: DocumentFile, etag: string) {
  const form = new FormData()
  form.append('document', filePart(document))
  return multipart('/api/v1/manager/station/resubmission', form, managerStationSchema, { 'If-Match': etag })
}

export const setStationLocation = (body: Schemas['SetLocationRequest'], etag: string) =>
  unwrapVersioned(
    api.PUT('/api/v1/manager/station/location', { params: ifMatch(etag), body }),
    setLocationResponseSchema,
  )

// --- Horaires ---------------------------------------------------------------------------------

export const openingHoursQuery = queryOptions({
  queryKey: managerKeys.hours(),
  queryFn: ({ signal }) =>
    unwrapVersioned(api.GET('/api/v1/manager/station/opening-hours', { signal }), openingHoursSchema),
})

export const replaceOpeningHours = (body: Schemas['ReplaceHoursRequest'], etag: string) =>
  unwrapVersioned(api.PUT('/api/v1/manager/station/opening-hours', { params: ifMatch(etag), body }), openingHoursSchema)

export const addClosure = (body: Schemas['AddClosureRequest'], etag: string) =>
  unwrapVersioned(api.POST('/api/v1/manager/station/closures', { params: ifMatch(etag), body }), closureSchema)

export const deleteClosure = (id: string, etag: string) =>
  unwrapEtag(
    api.DELETE('/api/v1/manager/station/closures/{id}', {
      params: { path: { id }, header: { 'If-Match': etag } },
    }),
  )

// --- Produits et stocks -----------------------------------------------------------------------

export const stationProductsQuery = queryOptions({
  queryKey: managerKeys.products(),
  queryFn: ({ signal }) =>
    unwrapVersioned(api.GET('/api/v1/manager/station/products', { signal }), stationProductListSchema),
})

export const setStationProducts = (productIds: number[], etag: string) =>
  unwrapVersioned(
    api.PUT('/api/v1/manager/station/products', { params: ifMatch(etag), body: { productIds } }),
    stationProductListSchema,
  )

export const stocksQuery = queryOptions({
  queryKey: managerKeys.stocks(),
  queryFn: ({ signal }) => unwrapVersioned(api.GET('/api/v1/manager/station/stocks', { signal }), stockListSchema),
})

export const updateStocks = (items: { productId: number; quantity: number }[], etag: string) =>
  unwrapVersioned(
    api.PUT('/api/v1/manager/station/stocks', { params: ifMatch(etag), body: { items } }),
    stockListSchema,
  )

export const confirmStocks = (etag: string) =>
  unwrapVersioned(api.POST('/api/v1/manager/station/stocks/confirm', { params: ifMatch(etag) }), stockListSchema)

export const muteReminders = () =>
  unwrapVersioned(api.POST('/api/v1/manager/reminders/mute'), muteResponseSchema).then((r) => r.data)

// --- Signalements -----------------------------------------------------------------------------

export const managerReportsQuery = (status: 'open' | 'all') =>
  queryOptions({
    queryKey: managerKeys.reports(status),
    queryFn: ({ signal }) =>
      unwrapVersioned(
        api.GET('/api/v1/manager/reports', { params: { query: { status, limit: 50 } }, signal }),
        managerReportPageSchema,
      ).then((r) => r.data),
  })
