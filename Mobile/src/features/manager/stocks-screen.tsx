import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet'
import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { ArrowRight, BellOff, Check, PackageOpen, Search, Send, Undo2, WifiOff } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { Alert, BackHandler, Keyboard, KeyboardAvoidingView, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { isApiError } from '@/api/errors'
import {
  confirmStocks,
  invalidateOtherVersions,
  isVersionConflict,
  managerStationQuery,
  muteReminders,
  stocksQuery,
  updateStocks,
  type Versioned,
} from '@/api/manager'
import type { StockList } from '@/api/schemas'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton } from '@/components/ui/skeleton'
import { TabScreen } from '@/components/ui/tab-screen'
import { Text } from '@/components/ui/text'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import { agoFrom, formatQuantity, formatTime } from '@/lib/format'
import { haptics } from '@/lib/haptics'
import { useNow } from '@/lib/use-now'
import { useOnline } from '@/lib/use-online'
import { useTheme } from '@/theme/theme'

import { PushDeniedBanner } from '@/features/notifications/push-denied-banner'

import { SetupChecklist } from './setup-checklist'
import { StockRow } from './stock-row'
import {
  lastStockActivity,
  quantityOf,
  type StockConflict,
  stockChanges,
  stockConflicts,
  stockPayload,
  stockReminderDue,
  useStockDraft,
} from './stock-draft'

/**
 * Accueil du gérant (D59, D60) : saisie des stocks en quelques secondes, d'une main. Brouillon
 * conservé (MMKV) ; hors connexion, l'envoi est bloqué puis proposé au retour du réseau, jamais
 * fait tout seul. Envoi groupé avec `If-Match` ; sur 412, ce qui a changé est montré et la
 * saisie est gardée au rechargement.
 */
export function StocksScreen() {
  const qc = useQueryClient()
  const online = useOnline()
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const station = useQuery(managerStationQuery)
  const stocks = useQuery(stocksQuery)
  const draft = useStockDraft()
  const stationId = station.data?.data.id ?? draft.stationId
  const base = draft.stationId === stationId ? draft.base : null
  const changes = stockChanges(base, draft.values)

  const [busy, setBusy] = useState(false)
  const [conflict, setConflict] = useState<{ list: StockConflict[]; server: Versioned<StockList> } | null>(null)
  const [mutedUntil, setMutedUntil] = useState<string | null>(null)
  const summary = useRef<BottomSheetModal>(null)
  const conflictSheet = useRef<BottomSheetModal>(null)
  const [backOnline, setBackOnline] = useState(false)
  const now = useNow(60_000)

  // Lecture de l'API → brouillon (la base n'est remplacée que sans saisie en cours).
  useEffect(() => {
    if (stocks.data && stationId) useStockDraft.getState().sync(stationId, stocks.data)
  }, [stocks.data, stationId])

  // Retour du réseau avec une saisie non envoyée : l'envoi est proposé, pas fait.
  useEffect(() => {
    let wasOffline = !onlineManager.isOnline()
    return onlineManager.subscribe((isOnline) => {
      if (!isOnline) wasOffline = true
      else if (wasOffline) {
        wasOffline = false
        if (Object.keys(useStockDraft.getState().values).length > 0) setBackOnline(true)
      }
    })
  }, [])

  const written = (res: Versioned<StockList>, message: string) => {
    useStockDraft.getState().committed(res)
    qc.setQueryData(stocksQuery.queryKey, res)
    void invalidateOtherVersions(qc, stocksQuery.queryKey)
    setBackOnline(false)
    haptics.success()
    toast.success(message)
  }

  /** Envoie la saisie (ou confirme) ; un 412 sans changement des stocks est rejoué une fois. */
  const send = async (retried = false) => {
    const snap = useStockDraft.getState().base
    const values = useStockDraft.getState().values
    if (!snap) return
    const n = stockChanges(snap, values).length
    setBusy(true)
    try {
      const res = n > 0 ? await updateStocks(stockPayload(snap, values), snap.etag) : await confirmStocks(snap.etag)
      summary.current?.dismiss()
      written(res, n > 0 ? t.manager.stocks.saved : t.manager.stocks.confirmed)
    } catch (e) {
      if (isVersionConflict(e)) {
        const server = await qc.fetchQuery({ ...stocksQuery, staleTime: 0 }).catch(() => null)
        if (!server) {
          haptics.error()
          toast.error(t.manager.stocks.loadError)
          return
        }
        const list = stockConflicts(snap, server.data, values)
        if (list.length === 0 && !retried) {
          // La version a changé ailleurs (horaires, profil…), pas les stocks : on rejoue.
          useStockDraft.getState().rebase(server)
          setBusy(false)
          return send(true)
        }
        summary.current?.dismiss()
        haptics.warning()
        setConflict({ list, server })
        conflictSheet.current?.present()
        return
      }
      haptics.error()
      toast.error(isApiError(e) ? e.userMessage : t.common.errorTitle)
    } finally {
      setBusy(false)
    }
  }

  const reload = () => {
    if (conflict) useStockDraft.getState().rebase(conflict.server)
    qc.setQueryData(stocksQuery.queryKey, conflict?.server)
    conflictSheet.current?.dismiss()
    setConflict(null)
  }

  const discard = () =>
    Alert.alert(t.manager.stocks.discardTitle, t.manager.stocks.discardBody, [
      { text: t.common.cancel, style: 'cancel' },
      { text: t.manager.stocks.discard, style: 'destructive', onPress: () => useStockDraft.getState().discard() },
    ])

  const mute = async () => {
    try {
      const r = await muteReminders()
      setMutedUntil(r.mutedUntil)
      haptics.success()
    } catch (e) {
      toast.error(isApiError(e) ? e.userMessage : t.common.errorTitle)
    }
  }

  const items = base?.items ?? []
  // Rappel dans l'app, avec ou sans push (téléphone sans services Google, notifications coupées).
  const reminderDue = !mutedUntil && stockReminderDue(items, now)
  const lastActivity = lastStockActivity(items)
  const setQuantity = (productId: number, q: number) => useStockDraft.getState().setQuantity(productId, q)
  const primary = () => {
    // Le retour d'Android ferme le clavier sans quitter le champ des litres : sans ce blur, il
    // resterait actif (contour, texte sélectionné) sous le récapitulatif et après l'envoi.
    Keyboard.dismiss()
    if (changes.length > 0) summary.current?.present()
    else void send()
  }

  return (
    <TabScreen
      title={t.manager.stocks.title}
      action={<IconButton icon={Search} label={t.manager.search} onPress={() => router.push('/manager/search')} />}
    >
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-4 px-5 pb-6">
          {station.data && (
            <Text variant="callout" tone="muted" numberOfLines={1}>
              {station.data.data.name}
            </Text>
          )}
          {station.data && !station.data.data.setup.searchable && <SetupChecklist setup={station.data.data.setup} />}
          <PushDeniedBanner audience="manager" />
          {reminderDue && lastActivity && (
            <Banner tone="warning" title={t.manager.stocks.reminderTitle}>
              {t.manager.stocks.reminderBody(agoFrom(lastActivity))}
            </Banner>
          )}

          {!online && (
            <Banner tone="info" title={t.common.offline}>
              {base
                ? `${t.manager.stocks.offline} ${t.manager.stocks.offlineSnapshot(agoFrom(new Date(base.fetchedAt).toISOString()))}`
                : t.manager.stocks.offline}
            </Banner>
          )}
          {online && backOnline && changes.length > 0 && (
            <Banner
              tone="success"
              action={<Button label={t.manager.stocks.sendNow} size="sm" variant="outline" onPress={primary} />}
            >
              {t.manager.stocks.backOnline}
            </Banner>
          )}
          {stocks.isError && !base && (
            <Banner
              tone="danger"
              action={<Button label={t.common.retry} size="sm" variant="outline" onPress={() => stocks.refetch()} />}
            >
              {t.manager.stocks.loadError}
            </Banner>
          )}

          {!base && stocks.isPending ? (
            <View className="gap-3">
              <Skeleton height={148} />
              <Skeleton height={148} />
            </View>
          ) : base && items.length === 0 ? (
            <EmptyState
              title={t.manager.stocks.empty}
              body={t.manager.stocks.emptyBody}
              action={
                <Button
                  label={t.manager.stocks.declareProducts}
                  icon={PackageOpen}
                  onPress={() => router.push('/manager/products')}
                />
              }
            />
          ) : (
            items.map((item) => (
              <StockRow
                key={item.productId}
                item={item}
                value={quantityOf(item, draft.values)}
                onChange={setQuantity}
              />
            ))
          )}

          {items.length > 0 && (
            <View className="gap-2 pt-2">
              {changes.length > 0 && (
                <Button label={t.manager.stocks.discard} icon={Undo2} variant="ghost" onPress={discard} />
              )}
              {mutedUntil ? (
                <Banner tone="info">{t.manager.stocks.muted(formatTime(mutedUntil))}</Banner>
              ) : (
                <Button
                  label={t.manager.stocks.mute}
                  icon={BellOff}
                  variant="ghost"
                  disabled={!online}
                  onPress={mute}
                />
              )}
            </View>
          )}
        </ScrollView>

        {items.length > 0 && (
          <View className="gap-2 border-t border-border bg-background px-5 pb-3 pt-3">
            {!online && (
              <View className="flex-row items-center gap-2" accessibilityLiveRegion="polite">
                <WifiOff size={16} color={colors['muted-foreground']} />
                <Text variant="footnote" tone="muted" className="flex-1">
                  {t.manager.stocks.draftKept}
                </Text>
              </View>
            )}
            <Button
              testID="stocks-submit"
              label={changes.length > 0 ? t.manager.stocks.save(changes.length) : t.manager.stocks.nothingChanged}
              icon={changes.length > 0 ? Send : Check}
              size="lg"
              loading={busy}
              disabled={!online || !base}
              onPress={primary}
            />
          </View>
        )}
      </KeyboardAvoidingView>

      <Sheet sheet={summary} bottom={insets.bottom}>
        <View className="gap-1 px-5 pb-2">
          <Text variant="title3" accessibilityRole="header">
            {t.manager.stocks.summaryTitle}
          </Text>
          <Text variant="subhead" tone="muted">
            {t.manager.stocks.summaryBody}
          </Text>
        </View>
        <View className="px-5">
          {changes.map((c) => (
            <View
              key={c.productId}
              className="min-h-14 justify-center gap-0.5 border-b border-border py-2"
              accessible
              accessibilityLabel={`${c.label} : ${formatQuantity(c.unit, c.from)}, ${formatQuantity(c.unit, c.to)}`}
            >
              <Text variant="body" weight="medium">
                {c.label}
              </Text>
              <View className="flex-row flex-wrap items-center gap-2">
                <Text variant="subhead" tone="muted" mono>
                  {formatQuantity(c.unit, c.from)}
                </Text>
                <ArrowRight size={16} color={colors['muted-foreground']} />
                <Text variant="subhead" weight="semibold" tone="brand" mono>
                  {formatQuantity(c.unit, c.to)}
                </Text>
              </View>
            </View>
          ))}
        </View>
        <View className="gap-2 px-5 pt-4">
          <Button
            testID="stocks-send"
            label={t.manager.stocks.send}
            icon={Send}
            size="lg"
            loading={busy}
            disabled={!online}
            onPress={() => send()}
          />
          <Button label={t.manager.stocks.edit} variant="ghost" onPress={() => summary.current?.dismiss()} />
        </View>
      </Sheet>

      <Sheet sheet={conflictSheet} bottom={insets.bottom}>
        <View className="gap-1 px-5 pb-2">
          <Text variant="title3" accessibilityRole="header">
            {t.manager.stocks.conflictTitle}
          </Text>
          <Text variant="subhead" tone="muted">
            {t.manager.stocks.conflictBody}
          </Text>
        </View>
        <View className="px-5">
          {conflict?.list.map((c) => (
            <View
              key={c.productId}
              className="gap-2 border-b border-border py-3"
              accessible
              accessibilityLabel={`${c.label} : ${t.manager.stocks.conflictBefore} ${formatQuantity(c.unit, c.before)}, ${t.manager.stocks.conflictNow} ${formatQuantity(c.unit, c.now)}, ${t.manager.stocks.conflictYours} ${formatQuantity(c.unit, c.yours)}`}
            >
              <Text variant="body" weight="medium">
                {c.label}
              </Text>
              <View className="flex-row gap-2">
                {(
                  [
                    [t.manager.stocks.conflictBefore, c.before, 'muted'],
                    [t.manager.stocks.conflictNow, c.now, 'default'],
                    [t.manager.stocks.conflictYours, c.yours, 'brand'],
                  ] as const
                ).map(([label, n, tone]) => (
                  <View key={label} className="flex-1 gap-0.5 rounded-lg bg-secondary px-3 py-2">
                    <Text variant="caption" tone="muted">
                      {label}
                    </Text>
                    <Text variant="subhead" weight="semibold" tone={tone} mono numberOfLines={1} adjustsFontSizeToFit>
                      {formatQuantity(c.unit, n)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
        <View className="px-5 pt-4">
          <Button testID="stocks-reload" label={t.manager.stocks.reload} size="lg" onPress={reload} />
        </View>
      </Sheet>
    </TabScreen>
  )
}

/** Feuille modale du bas (récapitulatif, conflit) : retour Android pour la fermer. */
function Sheet({
  sheet,
  bottom,
  children,
}: {
  sheet: React.RefObject<BottomSheetModal | null>
  bottom: number
  children: React.ReactNode
}) {
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      sheet.current?.dismiss()
      return true
    })
    return () => sub.remove()
  }, [open, sheet])
  return (
    <BottomSheetModal
      ref={sheet}
      enableDynamicSizing
      onChange={(i) => setOpen(i >= 0)}
      backgroundStyle={{ backgroundColor: colors.surface, borderRadius: 24 }}
      handleIndicatorStyle={{ backgroundColor: colors['border-strong'], width: 40 }}
      backdropComponent={(p) => <BottomSheetBackdrop {...p} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.4} />}
    >
      <BottomSheetView style={{ paddingBottom: bottom + 16 }}>{children}</BottomSheetView>
    </BottomSheetModal>
  )
}
