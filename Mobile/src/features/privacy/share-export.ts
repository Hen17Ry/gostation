import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'

import { API_URL, baseHeaders, session } from '@/api/client'
import { t } from '@/i18n'

/**
 * Télécharge la copie des données (lien signé de 15 min + session de la personne) dans le cache de
 * l'app, ouvre la feuille de partage du système, puis supprime le fichier : la copie ne reste pas
 * sur le téléphone. Renvoie false si le partage de fichiers n'existe pas sur l'appareil.
 */
export async function shareDataExport(downloadUrl: string, createdAt: string | null): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false
  const token = await session.accessToken()
  if (!token) throw new Error('no session')
  const day = (createdAt ?? new Date().toISOString()).slice(0, 10)
  const target = new File(Paths.cache, `gostation-mes-donnees-${day}.json`)
  if (target.exists) target.delete()
  const file = await File.downloadFileAsync(`${API_URL}${downloadUrl}`, target, {
    headers: { ...baseHeaders(), Authorization: `Bearer ${token}` },
    idempotent: true,
  })
  try {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/json',
      dialogTitle: t.privacy.exportShareTitle,
      UTI: 'public.json',
    })
  } finally {
    if (file.exists) file.delete()
  }
  return true
}
