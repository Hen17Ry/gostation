import { useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { Download, FileJson, MessageSquarePlus, PencilLine, RefreshCw, Trash2 } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { View } from 'react-native'

import { dataExportQuery, dataRequestsQuery, requestDataExport } from '@/api/account'
import { meKeys } from '@/api/keys'
import type { DataRequest } from '@/api/schemas'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Divider } from '@/components/ui/divider'
import { ListRow } from '@/components/ui/list-row'
import { Screen } from '@/components/ui/screen'
import { Section } from '@/components/ui/section'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Text } from '@/components/ui/text'
import { toast } from '@/components/ui/toast'
import { exportStep } from '@/features/privacy/export-state'
import { shareDataExport } from '@/features/privacy/share-export'
import { t } from '@/i18n'
import { errorMessage } from '@/lib/form-errors'
import { formatDate, formatDateTime } from '@/lib/format'
import { haptics } from '@/lib/haptics'
import { useTheme } from '@/theme/theme'

const STATUS_TONE: Record<DataRequest['status'], BadgeTone> = {
  pending: 'warning',
  in_progress: 'info',
  completed: 'success',
  rejected: 'neutral',
}

/**
 * Mes données (Compte) : copie des données à télécharger et partager, rectification, demandes
 * d'exercice des droits et leur suivi, suppression du compte.
 */
export default function MyData() {
  return (
    <Screen title={t.privacy.title} subtitle={t.privacy.intro}>
      <ExportCard />
      <Section title={t.privacy.rights}>
        <ListRow
          testID="data-rectify"
          icon={PencilLine}
          title={t.privacy.rectify}
          subtitle={t.privacy.rectifyHint}
          onPress={() => router.push('/profile/edit')}
        />
        <Divider className="ml-14" />
        <ListRow
          testID="data-request"
          icon={MessageSquarePlus}
          title={t.privacy.request}
          subtitle={t.privacy.requestHint}
          onPress={() => router.push('/profile/data-request')}
        />
      </Section>
      <Requests />
      <Section>
        <ListRow
          testID="data-delete"
          icon={Trash2}
          title={t.privacy.deleteAccount}
          subtitle={t.privacy.deleteHint}
          destructive
          onPress={() => router.push('/profile/delete')}
        />
      </Section>
    </Screen>
  )
}

function ExportCard() {
  const qc = useQueryClient()
  const { colors } = useTheme()
  const q = useQuery(dataExportQuery)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const step = exportStep(q.data)
  const status = q.data?.status
  // Copie prête : sa demande (type export) vient d'être close par le worker, la liste suit.
  useEffect(() => {
    if (status === 'ready') void qc.invalidateQueries({ queryKey: meKeys.dataRequests() })
  }, [status, qc])

  const prepare = async () => {
    setBusy(true)
    setError(null)
    try {
      qc.setQueryData(meKeys.dataExport(), await requestDataExport())
      void qc.invalidateQueries({ queryKey: meKeys.dataRequests() })
      haptics.success()
    } catch (e) {
      haptics.error()
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const share = async () => {
    setBusy(true)
    setError(null)
    try {
      // Lien neuf (valable 15 min) lu au moment du téléchargement.
      const fresh = await qc.fetchQuery({ ...dataExportQuery, staleTime: 0 })
      if (fresh.status !== 'ready' || !fresh.downloadUrl) return
      if (!(await shareDataExport(fresh.downloadUrl, fresh.createdAt))) toast.info(t.privacy.exportSharingUnavailable)
    } catch {
      haptics.error()
      setError(t.privacy.exportDownloadFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="gap-3" testID="data-export">
      <View className="flex-row items-center gap-3">
        <View
          className="h-10 w-10 items-center justify-center rounded-full bg-primary-subtle"
          accessibilityElementsHidden
        >
          <FileJson size={20} color={colors['primary-subtle-foreground']} strokeWidth={2.2} />
        </View>
        <Text variant="headline" accessibilityRole="header" className="flex-1">
          {t.privacy.exportSection}
        </Text>
      </View>
      <Text variant="subhead" tone="muted">
        {t.privacy.exportBody}
      </Text>
      {q.isPending ? (
        <Skeleton height={48} className="rounded-lg" />
      ) : step === 'preparing' ? (
        <View
          className="flex-row items-center gap-3 py-1"
          accessibilityLiveRegion="polite"
          testID="data-export-preparing"
        >
          <Spinner color={colors.primary} />
          <View className="flex-1 gap-0.5">
            <Text variant="subhead" weight="semibold">
              {t.privacy.exportPreparing}
            </Text>
            <Text variant="footnote" tone="muted">
              {t.privacy.exportPreparingBody}
            </Text>
          </View>
        </View>
      ) : step === 'share' ? (
        <View className="gap-2">
          <Banner tone="success">{t.privacy.exportReady(formatDateTime(q.data!.expiresAt!))}</Banner>
          <Button
            testID="data-export-share"
            label={t.privacy.exportShare}
            icon={Download}
            loading={busy}
            onPress={share}
          />
          <Text variant="footnote" tone="muted">
            {t.privacy.exportHint}
          </Text>
        </View>
      ) : (
        <View className="gap-2">
          {step === 'again' && (
            <Text variant="footnote" tone="muted" accessibilityLiveRegion="polite">
              {q.data?.status === 'failed' ? t.privacy.exportFailed : t.privacy.exportExpired}
            </Text>
          )}
          <Button
            testID="data-export-prepare"
            label={step === 'again' ? t.privacy.exportAgain : t.privacy.exportPrepare}
            icon={step === 'again' ? RefreshCw : FileJson}
            variant={step === 'again' ? 'outline' : 'primary'}
            loading={busy}
            onPress={prepare}
          />
        </View>
      )}
      {error && <Banner tone="danger">{error}</Banner>}
    </Card>
  )
}

function Requests() {
  const q = useQuery(dataRequestsQuery)
  const items = q.data ?? []
  return (
    <Section title={t.privacy.myRequests} bare>
      {q.isPending ? (
        <Skeleton height={72} className="rounded-xl" />
      ) : items.length === 0 ? (
        <Text variant="subhead" tone="muted" className="px-1">
          {t.privacy.noRequests}
        </Text>
      ) : (
        <View className="gap-2" testID="data-requests">
          {items.map((r) => (
            <RequestRow key={r.id} r={r} />
          ))}
        </View>
      )}
    </Section>
  )
}

function RequestRow({ r }: { r: DataRequest }) {
  const open = r.status === 'pending' || r.status === 'in_progress'
  return (
    <Card className="gap-1.5" testID={`data-request-${r.reference}`}>
      <View className="flex-row items-start justify-between gap-2">
        <Text variant="body" weight="semibold" className="flex-1">
          {t.privacy.types[r.type]}
        </Text>
        <Badge label={t.privacy.statuses[r.status]!} tone={STATUS_TONE[r.status]} />
      </View>
      <Text variant="footnote" tone="muted">
        {t.privacy.requestMeta(r.reference, formatDate(r.createdAt))}
      </Text>
      {open ? (
        <Text variant="footnote" tone="muted">
          {t.privacy.dueOn(formatDate(r.dueAt))}
        </Text>
      ) : (
        r.response && (
          <View className="gap-0.5 pt-1">
            <Text variant="caption" tone="muted">
              {r.completedAt ? t.privacy.answeredOn(formatDate(r.completedAt)) : t.privacy.statuses[r.status]}
            </Text>
            <Text variant="subhead">{r.response}</Text>
          </View>
        )
      )}
    </Card>
  )
}
