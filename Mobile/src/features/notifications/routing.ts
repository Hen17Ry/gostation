import type { Href } from 'expo-router'

/**
 * Écran ouvert par une notification (push touché, action « Mettre à jour », ligne de la boîte de
 * réception), par les liens stables de D61. Un lien vers l'espace gérant ouvert par un autre
 * compte (ou sans session) mène à l'accueil de son espace : les gardes de navigation s'en chargent.
 */
export function notificationHref(data: Record<string, unknown> | null | undefined): Href | null {
  const stationId = typeof data?.stationId === 'string' ? data.stationId : null
  switch (data?.type) {
    case 'stock_reminder':
      return '/manager/stocks'
    case 'station_reported':
      return '/manager/reports'
    case 'back_in_stock':
      return stationId ? { pathname: '/station/[id]', params: { id: stationId } } : '/favorites'
    case 'station_decision':
      // Refus et suspension : écran de statut (motif, correction) ; sinon la station.
      return data.decision === 'rejected' || data.decision === 'suspended' ? '/manager/status' : '/manager/station'
    default:
      return null
  }
}

/** Données d'un push (Expo les place dans `content.data`, ou en JSON dans `dataString`). */
export function pushData(
  content: { data?: unknown; dataString?: unknown } | null | undefined,
): Record<string, unknown> {
  if (content?.data && typeof content.data === 'object') return content.data as Record<string, unknown>
  if (typeof content?.dataString === 'string') {
    try {
      const parsed: unknown = JSON.parse(content.dataString)
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
    } catch {
      // charge utile illisible : aucune donnée
    }
  }
  return {}
}
