import type { DataExport } from '@/api/schemas'

/** Ce que l'écran « Mes données » propose pour la copie, selon son état. */
export type ExportStep = 'prepare' | 'preparing' | 'share' | 'again'

export function exportStep(e: DataExport | undefined): ExportStep {
  switch (e?.status) {
    case 'pending':
      return 'preparing'
    case 'ready':
      return e.downloadUrl ? 'share' : 'again'
    case 'failed':
    case 'expired':
      return 'again'
    default:
      return 'prepare'
  }
}
