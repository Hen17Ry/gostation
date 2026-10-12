import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { stationQuery } from '@/api/admin'
import type { Station } from '@/api/admin-schemas'
import { isApiError } from '@/api/errors'
import { alertKeys, counterKeys, reportKeys, stationKeys } from '@/api/keys'
import { ta } from '@/i18n/admin'

/**
 * Écriture sur une station (décision, déplacement, épingle, correction). Lit la dernière version
 * connue au moment d'agir (If-Match), met la fiche à jour avec la réponse puis rafraîchit listes,
 * compteurs et historique. Sur 412, la fiche est rechargée et l'erreur remonte au dialogue (qui
 * garde la saisie) : l'admin vérifie le nouvel état puis confirme à nouveau.
 */
export function useStationWrite(id: string) {
  const qc = useQueryClient()

  function current(): Station {
    const s = qc.getQueryData(stationQuery(id).queryKey)
    if (!s) throw new Error('station not loaded')
    return s
  }

  async function run(write: (s: Station) => Promise<Station>, success: string, description?: string) {
    try {
      const updated = await write(current())
      qc.setQueryData(stationQuery(id).queryKey, updated)
      void qc.invalidateQueries({ queryKey: stationKeys.lists() })
      void qc.invalidateQueries({ queryKey: stationKeys.timeline(id) })
      void qc.invalidateQueries({ queryKey: stationKeys.map() })
      void qc.invalidateQueries({ queryKey: counterKeys.all })
      void qc.invalidateQueries({ queryKey: reportKeys.all })
      void qc.invalidateQueries({ queryKey: alertKeys.all })
      toast.success(success, description ? { description } : undefined)
      return updated
    } catch (e) {
      if (isApiError(e) && (e.status === 412 || e.code === 'resource.version_conflict')) {
        await qc.invalidateQueries({ queryKey: stationQuery(id).queryKey })
        toast.warning(ta.conflict.title, { description: ta.conflict.body })
      }
      throw e
    }
  }

  return { run, current }
}
