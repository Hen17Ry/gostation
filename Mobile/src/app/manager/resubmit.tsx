import { useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { Send } from 'lucide-react-native'
import { useEffect, useState } from 'react'

import { isApiError } from '@/api/errors'
import { meKeys } from '@/api/keys'
import { type DocumentFile, managerStationQuery, resubmitDocument } from '@/api/manager'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Screen } from '@/components/ui/screen'
import { toast } from '@/components/ui/toast'
import { discardDocument } from '@/features/manager/document'
import { DocumentField } from '@/features/manager/document-field'
import { t } from '@/i18n'
import { haptics } from '@/lib/haptics'

/** Dossier refusé : nouveau justificatif, la station repasse en vérification (D15). */
export default function Resubmit() {
  const qc = useQueryClient()
  const station = useQuery(managerStationQuery)
  const [doc, setDoc] = useState<DocumentFile | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Écran quitté sans envoi : la copie locale du justificatif est supprimée.
  useEffect(() => () => discardDocument(doc), [doc])

  const send = async () => {
    if (!doc) {
      setError(t.manager.documentRequired)
      return
    }
    if (!station.data) return
    setBusy(true)
    setError(null)
    try {
      await resubmitDocument(doc, station.data.etag)
      discardDocument(doc)
      setDoc(null)
      haptics.success()
      toast.success(t.manager.status.resubmitted)
      await qc.invalidateQueries({ queryKey: meKeys.profile() })
      router.back()
    } catch (e) {
      haptics.error()
      if (isApiError(e) && e.code === 'resource.version_conflict') void station.refetch()
      setError(isApiError(e) ? e.userMessage : t.common.errorTitle)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen
      title={t.manager.status.resubmit}
      subtitle={t.manager.stepHints[2]}
      footer={
        <Button testID="resubmit-send" label={t.manager.submit} icon={Send} size="lg" loading={busy} onPress={send} />
      }
    >
      {station.isError && <Banner tone="danger">{t.common.errorTitle}</Banner>}
      <DocumentField value={doc} onChange={setDoc} error={error} />
    </Screen>
  )
}
