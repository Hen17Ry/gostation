/**
 * Requêtes et écritures de l'administration. Les listes sont paginées par curseur côté serveur ;
 * leurs filtres font partie de la clé (et de l'URL de l'écran). Toute écriture sur une station
 * envoie If-Match = "v{version}" (verrouillage optimiste) : un 412 signale un changement entre-temps.
 */
import { keepPreviousData, queryOptions } from '@tanstack/react-query'

import {
  type Alert,
  alertPageSchema,
  alertSchema,
  auditPageSchema,
  type DataRequest,
  dataRequestPageSchema,
  dataRequestSchema,
  type DataRequestStatus,
  type DataRequestType,
  type Dataset,
  type Export,
  exportPageSchema,
  exportSchema,
  type Product,
  productPageSchema,
  productSchema,
  type Report,
  reportPageSchema,
  type ReportReason,
  reportSchema,
  shortageMapSchema,
  type Station,
  stationMapSchema,
  stationPageSchema,
  stationSchema,
  type User,
  userPageSchema,
  userSchema,
} from './admin-schemas'
import { api, API_BASE_URL, session, unwrap } from './client'
import { ApiError } from './errors'
import {
  alertKeys,
  auditKeys,
  dataRequestKeys,
  exportKeys,
  productKeys,
  reportKeys,
  shortageKeys,
  stationKeys,
  userKeys,
} from './keys'

export const ifMatch = (version: number) => ({ 'If-Match': `"v${version}"` })

export { countersQuery } from './counters'

// ── Stations ────────────────────────────────────────────────────────────────

export interface StationFilters {
  status: 'pending' | 'approved' | 'rejected' | 'suspended' | 'all'
  q?: string
  needsReview?: boolean
  freshness?: 'stale' | 'expired'
  managerInactive?: boolean
  noHours?: boolean
  reported?: boolean
  excluded?: boolean
  cursor?: string
  limit?: number
}

export const stationsQuery = (f: StationFilters) =>
  queryOptions({
    queryKey: stationKeys.list(f),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/admin/stations', { params: { query: { limit: 25, ...f } }, signal }), stationPageSchema),
    placeholderData: keepPreviousData,
  })

export const stationQuery = (id: string) =>
  queryOptions({
    queryKey: stationKeys.detail(id),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/admin/stations/{id}', { params: { path: { id } }, signal }), stationSchema),
  })

/** Historique d'une station : son journal d'audit (statuts, corrections, épingle, horaires…). */
export const stationTimelineQuery = (id: string) =>
  queryOptions({
    queryKey: stationKeys.timeline(id),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/api/v1/admin/audit', {
          params: { query: { entityType: 'station', entityId: id, limit: 50 } },
          signal,
        }),
        auditPageSchema,
      ),
  })

export type MapStatus = 'all' | 'pending' | 'approved' | 'rejected' | 'suspended'

export const stationMapQuery = (status: MapStatus) =>
  queryOptions({
    queryKey: [...stationKeys.map(), status],
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/admin/stations/map', { params: { query: { status } }, signal }), stationMapSchema),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })

export type StationDecision = 'approve' | 'reject' | 'suspend' | 'unsuspend'

export function decideStation(s: Pick<Station, 'id' | 'version'>, decision: StationDecision, reason?: string) {
  const params = { path: { id: s.id }, header: ifMatch(s.version) }
  const body = { reason: reason ?? '' }
  switch (decision) {
    case 'approve':
      return unwrap(api.POST('/api/v1/admin/stations/{id}/approve', { params }), stationSchema)
    case 'reject':
      return unwrap(api.POST('/api/v1/admin/stations/{id}/reject', { params, body }), stationSchema)
    case 'suspend':
      return unwrap(api.POST('/api/v1/admin/stations/{id}/suspend', { params, body }), stationSchema)
    case 'unsuspend':
      return unwrap(api.POST('/api/v1/admin/stations/{id}/unsuspend', { params, body }), stationSchema)
  }
}

export function decideMove(s: Station, requestId: string, approve: boolean, reason?: string) {
  const params = { path: { id: s.id, requestId }, header: ifMatch(s.version) }
  return approve
    ? unwrap(api.POST('/api/v1/admin/stations/{id}/location-requests/{requestId}/approve', { params }), stationSchema)
    : unwrap(
        api.POST('/api/v1/admin/stations/{id}/location-requests/{requestId}/reject', {
          params,
          body: { reason: reason ?? '' },
        }),
        stationSchema,
      )
}

export const dismissLocationFlag = (s: Station) =>
  unwrap(
    api.POST('/api/v1/admin/stations/{id}/location-flag/dismiss', {
      params: { path: { id: s.id }, header: ifMatch(s.version) },
    }),
    stationSchema,
  )

export interface StationCorrection {
  name?: string
  brand?: string
  address?: string
  city?: string
  phone?: string
  ifu?: string
  rccm?: string
  reason: string
}

export const correctStation = (id: string, version: number, body: StationCorrection) =>
  unwrap(
    api.PATCH('/api/v1/admin/stations/{id}', { params: { path: { id }, header: ifMatch(version) }, body }),
    stationSchema,
  )

/** Types de justificatif affichables : tout autre type n'est proposé qu'au téléchargement. */
export const VIEWABLE_DOCUMENTS = ['application/pdf', 'image/png', 'image/jpeg'] as const

/**
 * Justificatif IFU (endpoint admin dédié, audité). Le Blob est retypé d'après la liste blanche :
 * jamais un type servi tel quel (un document ne doit jamais s'exécuter dans l'origine de l'admin).
 */
export async function fetchStationDocument(id: string, signal?: AbortSignal): Promise<{ blob: Blob; mime: string }> {
  const res = await session.authFetch(
    new Request(`${API_BASE_URL}/api/v1/admin/stations/${encodeURIComponent(id)}/document`, {
      credentials: 'include',
      signal,
    }),
  )
  if (!res.ok) throw ApiError.fromResponse(res, await res.json().catch(() => null))
  const served = (res.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase()
  const mime = (VIEWABLE_DOCUMENTS as readonly string[]).includes(served) ? served : 'application/octet-stream'
  return { blob: new Blob([await res.arrayBuffer()], { type: mime }), mime }
}

// ── Cartes ──────────────────────────────────────────────────────────────────

export interface ShortageFilters {
  period: '24h' | '7d' | '30d'
  productId?: number
}

export const shortagesQuery = (f: ShortageFilters) =>
  queryOptions({
    queryKey: shortageKeys.map(f),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/admin/stats/shortages', { params: { query: f }, signal }), shortageMapSchema),
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  })

// ── Signalements et alertes ─────────────────────────────────────────────────

export interface ReportFilters {
  status?: 'open' | 'resolved' | 'dismissed'
  reason?: ReportReason
  stationId?: string
  cursor?: string
}

export const reportsQuery = (f: ReportFilters) =>
  queryOptions({
    queryKey: reportKeys.list(f),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/admin/reports', { params: { query: { limit: 25, ...f } }, signal }), reportPageSchema),
    placeholderData: keepPreviousData,
  })

export const resolveReport = (id: string, note?: string): Promise<Report> =>
  unwrap(api.POST('/api/v1/admin/reports/{id}/resolve', { params: { path: { id } }, body: { note } }), reportSchema)

export const dismissReport = (id: string, abusive: boolean, note?: string): Promise<Report> =>
  unwrap(
    api.POST('/api/v1/admin/reports/{id}/dismiss', { params: { path: { id } }, body: { abusive, note } }),
    reportSchema,
  )

export async function setReportingBan(userId: string, banned: boolean, reason: string): Promise<void> {
  const params = { path: { id: userId } }
  await unwrap(
    banned
      ? api.POST('/api/v1/admin/users/{id}/reporting-ban', { params, body: { reason } })
      : api.POST('/api/v1/admin/users/{id}/reporting-ban/lift', { params, body: { reason } }),
  )
}

export interface AlertFilters {
  status: 'open' | 'resolved' | 'all'
  kind?: Alert['kind']
  cursor?: string
}

export const alertsQuery = (f: AlertFilters) =>
  queryOptions({
    queryKey: alertKeys.list(f),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/admin/alerts', { params: { query: { limit: 25, ...f } }, signal }), alertPageSchema),
    placeholderData: keepPreviousData,
  })

export const resolveAlert = (id: string, note?: string): Promise<Alert> =>
  unwrap(api.POST('/api/v1/admin/alerts/{id}/resolve', { params: { path: { id } }, body: { note } }), alertSchema)

// ── Comptes ─────────────────────────────────────────────────────────────────

export interface UserFilters {
  q?: string
  role?: User['role']
  status?: User['status']
  emailVerified?: boolean
  cursor?: string
}

export const usersQuery = (f: UserFilters) =>
  queryOptions({
    queryKey: userKeys.list(f),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/admin/users', { params: { query: { limit: 25, ...f } }, signal }), userPageSchema),
    placeholderData: keepPreviousData,
  })

export const userQuery = (id: string) =>
  queryOptions({
    queryKey: userKeys.detail(id),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/admin/users/{id}', { params: { path: { id } }, signal }), userSchema),
  })

export type UserAction = 'disable' | 'reactivate' | 'resend'

export function userAction(id: string, action: UserAction, reason: string): Promise<User | undefined> {
  const opts = { params: { path: { id } }, body: { reason } }
  switch (action) {
    case 'disable':
      return unwrap(api.POST('/api/v1/admin/users/{id}/disable', opts), userSchema)
    case 'reactivate':
      return unwrap(api.POST('/api/v1/admin/users/{id}/reactivate', opts), userSchema)
    case 'resend':
      return unwrap(api.POST('/api/v1/admin/users/{id}/resend-verification', opts)).then(() => undefined)
  }
}

// ── Catalogue ───────────────────────────────────────────────────────────────

export const productsQuery = queryOptions({
  queryKey: productKeys.all,
  queryFn: ({ signal }) =>
    unwrap(api.GET('/api/v1/admin/products', { params: { query: { limit: 100 } }, signal }), productPageSchema),
})

export interface NewProduct {
  kind: Product['kind']
  sizeKg?: number
  label: string
  active: boolean
}

export const createProduct = (body: NewProduct) => unwrap(api.POST('/api/v1/admin/products', { body }), productSchema)

export const updateProduct = (id: number, body: { label?: string; sortOrder?: number; active?: boolean }) =>
  unwrap(api.PATCH('/api/v1/admin/products/{id}', { params: { path: { id } }, body }), productSchema)

// ── Audit ───────────────────────────────────────────────────────────────────

export interface AuditFilters {
  actorId?: string
  action?: string
  entityType?: string
  entityId?: string
  from?: string
  to?: string
  cursor?: string
}

export const auditQuery = (f: AuditFilters) =>
  queryOptions({
    queryKey: auditKeys.list(f),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/admin/audit', { params: { query: { limit: 25, ...f } }, signal }), auditPageSchema),
    placeholderData: keepPreviousData,
  })

// ── Demandes de données ─────────────────────────────────────────────────────

export interface DataRequestFilters {
  /** open : reçues et en cours ; all : sans filtre de statut. */
  status: 'open' | 'all' | DataRequestStatus
  type?: DataRequestType
  overdue?: boolean
  cursor?: string
}

export const dataRequestsQuery = (f: DataRequestFilters) =>
  queryOptions({
    queryKey: dataRequestKeys.list(f),
    queryFn: ({ signal }) => {
      const { status, ...rest } = f
      const query = { limit: 25, ...rest, status: status === 'all' ? undefined : status }
      return unwrap(api.GET('/api/v1/admin/data-requests', { params: { query }, signal }), dataRequestPageSchema)
    },
    placeholderData: keepPreviousData,
  })

export const dataRequestQuery = (id: string) =>
  queryOptions({
    queryKey: dataRequestKeys.detail(id),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/admin/data-requests/{id}', { params: { path: { id } }, signal }), dataRequestSchema),
  })

/** Demande reçue par email : un code de confirmation part vers l'adresse du compte. */
export const recordDataRequest = (body: { email: string; type: DataRequestType; details?: string }) =>
  unwrap(api.POST('/api/v1/admin/data-requests', { body }), dataRequestSchema)

export const resendDataRequestCode = (id: string) =>
  unwrap(api.POST('/api/v1/admin/data-requests/{id}/code', { params: { path: { id } } }), dataRequestSchema)

type VersionedRequest = Pick<DataRequest, 'id' | 'version'>
const requestParams = (r: VersionedRequest) => ({ path: { id: r.id }, header: ifMatch(r.version) })

export const verifyDataRequest = (r: VersionedRequest, code: string) =>
  unwrap(
    api.POST('/api/v1/admin/data-requests/{id}/verify', { params: requestParams(r), body: { code } }),
    dataRequestSchema,
  )

export const startDataRequest = (r: VersionedRequest) =>
  unwrap(api.POST('/api/v1/admin/data-requests/{id}/start', { params: requestParams(r) }), dataRequestSchema)

/** Génère la copie des données de la personne : elle la télécharge dans son app, jamais l'admin. */
export const exportDataRequest = (r: VersionedRequest) =>
  unwrap(api.POST('/api/v1/admin/data-requests/{id}/export', { params: requestParams(r) }), dataRequestSchema)

export const deleteDataRequestAccount = (r: VersionedRequest, response?: string) =>
  unwrap(
    api.POST('/api/v1/admin/data-requests/{id}/delete-account', {
      params: requestParams(r),
      body: response ? { response } : {},
    }),
    dataRequestSchema,
  )

export const closeDataRequest = (r: VersionedRequest, outcome: 'completed' | 'rejected', response: string) =>
  unwrap(
    api.POST('/api/v1/admin/data-requests/{id}/close', { params: requestParams(r), body: { outcome, response } }),
    dataRequestSchema,
  )

// ── Exports ─────────────────────────────────────────────────────────────────

export const exportsQuery = (cursor?: string) =>
  queryOptions({
    queryKey: exportKeys.list(cursor),
    queryFn: ({ signal }) =>
      unwrap(api.GET('/api/v1/admin/exports', { params: { query: { limit: 20, cursor } }, signal }), exportPageSchema),
    placeholderData: keepPreviousData,
    // Suivi du statut : on interroge toutes les 3 s tant qu'un export est en cours de génération.
    refetchInterval: (q) => (q.state.data?.items.some((e) => e.status === 'pending') ? 3_000 : false),
  })

export interface NewExport {
  dataset: Dataset
  format: Export['format']
  from?: string
  to?: string
  productId?: number
}

export const createExport = (body: NewExport) => unwrap(api.POST('/api/v1/admin/exports', { body }), exportSchema)

/**
 * Télécharge un export par son lien signé (valable 1 h, à appeler avec la session admin) et le
 * propose à l'enregistrement. Le fichier transite en mémoire puis l'URL objet est révoquée.
 */
export async function downloadExport(e: Export): Promise<void> {
  if (!e.download) throw new ApiError({ status: 410, code: 'export.not_ready' })
  const res = await session.authFetch(new Request(`${API_BASE_URL}${e.download.url}`, { credentials: 'include' }))
  if (!res.ok) throw ApiError.fromResponse(res, await res.json().catch(() => null))
  const name =
    /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ??
    `gostation-${e.dataset}-${e.id.slice(0, 8)}.${e.format}`
  const url = URL.createObjectURL(await res.blob())
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.rel = 'noopener'
    document.body.append(a)
    a.click()
    a.remove()
  } finally {
    // Laisse au navigateur le temps de démarrer le téléchargement avant de libérer la mémoire.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
}
