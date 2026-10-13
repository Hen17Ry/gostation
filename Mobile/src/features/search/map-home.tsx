import BottomSheet, { useBottomSheetScrollableCreator } from '@gorhom/bottom-sheet'
import { useQuery } from '@tanstack/react-query'
import * as Linking from 'expo-linking'
import { router, useFocusEffect } from 'expo-router'
import { LocateFixed, MapPin, MapPinned, Search, SlidersHorizontal, WifiOff } from 'lucide-react-native'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type LayoutChangeEvent, View } from 'react-native'
import { interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { productsQuery } from '@/api/public'
import type { SearchResult } from '@/api/schemas'
import { NoStationIllustration } from '@/components/ui/illustrations'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { PressableScale } from '@/components/ui/pressable-scale'
import { Text } from '@/components/ui/text'
import { toast } from '@/components/ui/toast'
import { searchOrigin, useLocation } from '@/features/location/location-store'
import { t } from '@/i18n'
import { AnimatedView } from '@/lib/animated'
import { haptics } from '@/lib/haptics'
import { useOnline } from '@/lib/use-online'
import { StationsMap, type StationsMapHandle } from '@/map/stations-map'
import { usePrefs } from '@/stores/prefs'
import { elevation } from '@/theme/elevation'
import { useTheme } from '@/theme/theme'

import { ProductPicker, productLabel } from './product-picker'
import { ResultsList, type ResultsListHandle } from './results-list'
import { resultsSummary } from './results-summary'
import { SearchPulse } from './search-pulse'
import { useSearch } from './search-store'

const HANDLE_H = 24
const NO_RESULTS: SearchResult[] = []

/**
 * Accueil : carte plein écran + panneau de recherche (bottom sheet). Le panneau montre d'abord le
 * choix du produit et le bouton Rechercher ; après une recherche, il se replie en résumé et liste
 * les stations (FlashList), aussi posées en marqueurs sur la carte.
 */
export function MapHome() {
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const online = useOnline()
  const map = useRef<StationsMapHandle>(null)
  const sheet = useRef<BottomSheet>(null)
  const list = useRef<ResultsListHandle>(null)
  const sheetPosition = useSharedValue(0)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [headerH, setHeaderH] = useState(320)
  const [pickerOpen, setPickerOpen] = useState(true)

  const products = useQuery(productsQuery)
  const productId = usePrefs((s) => s.productId)
  const setProductId = usePrefs((s) => s.setProductId)
  const loc = useLocation()
  const origin = searchOrigin(loc)
  const search = useSearch()
  const response = search.response
  const results = useMemo(() => response?.results ?? NO_RESULTS, [response])
  const searching = search.status === 'searching'
  const picking = loc.mode === 'manual' || loc.permission === 'denied' || loc.permission === 'undetermined'
  // Position de l'appareil lisible au moment de l'appui (même si aucune mesure n'est encore connue).
  const canLocate = loc.mode === 'device' && loc.permission === 'granted'

  // Produit par défaut (premier lancement, ou produit retiré du catalogue) : gaz de taille moyenne.
  useEffect(() => {
    const items = products.data
    if (!items?.length) return
    if (productId !== null && items.some((p) => p.id === productId)) return
    const lpg = items.filter((p) => p.kind === 'lpg').sort((a, b) => (a.sizeKg ?? 0) - (b.sizeKg ?? 0))
    const fallback = lpg[Math.min(1, lpg.length - 1)] ?? items[0]
    if (fallback) setProductId(fallback.id)
  }, [products.data, productId, setProductId])

  const snapPoints = useMemo(() => {
    const peek = Math.min(headerH + HANDLE_H, size.h * 0.6 || 400)
    // Cran haut : sous la pastille de position (le panneau ne passe jamais dessous).
    const top = size.h - (insets.top + 64)
    return [peek, Math.max(peek + 1, size.h * 0.55), Math.max(peek + 2, top)]
  }, [headerH, size.h, insets.top])
  const sheetHeight = useCallback((i: number) => (typeof snapPoints[i] === 'number' ? snapPoints[i] : 0), [snapPoints])

  // Localisation au premier affichage de la carte (permission demandée à l'accueil).
  useEffect(() => {
    void (async () => {
      const permission = await useLocation.getState().refreshPermission()
      if (permission !== 'granted') return
      const p = await useLocation.getState().locate()
      if (p) map.current?.centerOn(p, { zoom: 13, bottom: sheetHeight(0) })
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une fois, à l'ouverture
  }, [])

  // Au retour sur l'onglet (réglages système modifiés), on relit la permission.
  useFocusEffect(
    useCallback(() => {
      void useLocation.getState().refreshPermission()
    }, []),
  )

  // Un seul défilant dans ce panneau : pas besoin de focusHook.
  const scrollable = useBottomSheetScrollableCreator()

  const runSearch = async () => {
    if (!productId) return
    haptics.light()
    let from = origin
    if (canLocate) from = (await loc.locate({ interactive: true })) ?? from
    if (!from) {
      haptics.warning()
      toast.info(t.location.unavailable)
      return
    }
    map.current?.centerOn(from, { zoom: 13, bottom: sheetHeight(0) })
    const res = await search.run(from, productId)
    if (!res) {
      const err = useSearch.getState().error
      if (err?.code === 'search.out_of_coverage') router.push('/out-of-coverage')
      else haptics.error()
      return
    }
    if (res.results.length === 0) {
      // Panneau ouvert en grand : le choix du produit reste en tête et le message « aucune
      // station » est visible en entier sous lui.
      haptics.warning()
      sheet.current?.snapToIndex(2)
      return
    }
    haptics.success()
    setPickerOpen(false)
    // Les cartes de résultats se montent d'abord ; panneau et caméra s'animent deux images plus
    // tard, pour ne pas créer les vues natives pendant les animations (image perdue sinon).
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        sheet.current?.snapToIndex(1)
        map.current?.fitResults(res.results, from, sheetHeight(1))
      }),
    )
  }

  const onSelect = (id: string) => {
    haptics.selection()
    search.select(id)
    const index = results.findIndex((r) => r.station.id === id)
    if (index >= 0) {
      sheet.current?.snapToIndex(1)
      list.current?.scrollToResult(index)
    }
  }

  const openStation = useCallback((id: string) => router.push({ pathname: '/station/[id]', params: { id } }), [])
  const openRoute = useCallback((id: string) => router.push({ pathname: '/route/[id]', params: { id } }), [])

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })

  // Bouton « ma position » posé au-dessus du panneau, masqué quand le panneau occupe l'écran.
  const fabStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheetPosition.value, [size.h * 0.35, size.h * 0.5], [0, 1], 'clamp'),
    transform: [{ translateY: sheetPosition.value - 64 }],
  }))

  const topInset = insets.top + 8
  // Haut de la zone utile de la carte (sous la pastille de position) : même valeur pour la caméra et les ondes.
  const mapTop = topInset + 56
  const pulseY = mapTop + (size.h - mapTop - sheetHeight(0)) / 2
  const product = products.data?.find((p) => p.id === productId)
  const unit = response?.product.unit ?? product?.unit ?? 'cylinder'

  // Bloc fixe en tête du panneau (choix du produit ou résumé « Modifier ») : il ne défile pas avec
  // la liste, l'action reste toujours à portée.
  const topBlock = (
    <View onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)} className="gap-4 px-4 pb-4 pt-1">
      {pickerOpen || !response ? (
        <>
          <Text variant="title3" accessibilityRole="header">
            {t.search.title}
          </Text>
          {products.isError && !products.data ? (
            <Banner
              tone="danger"
              action={<Button label={t.common.retry} size="sm" variant="outline" onPress={() => products.refetch()} />}
            >
              {t.search.catalogError}
            </Banner>
          ) : (
            <ProductPicker products={products.data} productId={productId} onChange={setProductId} />
          )}
          {!online && <Banner tone="info">{t.search.offlineSearch}</Banner>}
          {picking && !origin && <Banner tone="info">{t.location.pickHint}</Banner>}
          <Button
            testID="search-submit"
            label={searching ? t.search.searching : t.search.submit}
            icon={Search}
            size="lg"
            loading={searching}
            disabled={!productId || !online || (!origin && !canLocate)}
            onPress={runSearch}
          />
        </>
      ) : (
        <Summary
          label={product ? productLabel(product) : response.product.label}
          summary={resultsSummary(results, response.routingApproximate)}
          onEdit={() => {
            setPickerOpen(true)
            sheet.current?.snapToIndex(0)
          }}
        />
      )}
    </View>
  )

  const header = (
    <View>
      {response && (
        <View className="gap-3 px-4 pb-3">
          {!online && (
            <Banner tone="info" title={t.common.offline}>
              {t.search.offlineResults}
            </Banner>
          )}
          {search.status === 'error' && search.error && search.error.code !== 'search.out_of_coverage' && online && (
            <Banner
              tone="danger"
              action={<Button label={t.common.retry} size="sm" variant="outline" onPress={runSearch} />}
            >
              {search.error.userMessage}
            </Banner>
          )}
          {response.routingApproximate && results.length > 0 && <Banner tone="warning">{t.search.approximate}</Banner>}
          {response.strategy === 'fallback' && <Banner tone="info">{t.search.fallback}</Banner>}
          {results.length > 0 && (
            <Text
              variant="footnote"
              weight="semibold"
              tone="muted"
              className="uppercase tracking-wide"
              accessibilityRole="header"
            >
              {t.search.resultsLabel}
            </Text>
          )}
        </View>
      )}
      {!response && search.status === 'error' && search.error && search.error.code !== 'search.out_of_coverage' && (
        <View className="px-4 pb-3">
          <Banner tone="danger">{search.error.userMessage}</Banner>
        </View>
      )}
    </View>
  )

  return (
    <View className="flex-1 bg-background" onLayout={onLayout}>
      <StationsMap
        ref={map}
        results={results}
        selectedId={search.selectedId}
        origin={search.origin}
        manual={loc.mode === 'manual' ? loc.manual : null}
        showUser={loc.permission === 'granted'}
        topInset={mapTop}
        onSelect={onSelect}
        onPressMap={(p) => {
          if (!picking) return
          haptics.selection()
          loc.setManual(p)
        }}
        onLongPressMap={(p) => {
          haptics.light()
          loc.setManual(p)
        }}
      />

      {searching && size.w > 0 && (
        <SearchPulse x={size.w / 2} y={pulseY} radius={Math.min(size.w, size.h - sheetHeight(0)) * 0.42} />
      )}

      <TopBar
        top={topInset}
        online={online}
        mode={loc.mode}
        hasManual={!!loc.manual}
        permission={loc.permission}
        canAskAgain={loc.canAskAgain}
        onUseDevice={async () => {
          loc.useDevice()
          const p = await loc.locate()
          if (p) map.current?.centerOn(p, { bottom: sheetHeight(0) })
        }}
        onAllow={async () => {
          if (!loc.canAskAgain) {
            void Linking.openSettings()
            return
          }
          const permission = await loc.requestPermission()
          if (permission === 'granted') {
            const p = await loc.locate()
            if (p) map.current?.centerOn(p, { bottom: sheetHeight(0) })
          }
        }}
      />

      <AnimatedView pointerEvents="box-none" className="absolute right-4 top-0" style={fabStyle}>
        <IconButton
          floating
          icon={LocateFixed}
          label={t.location.centerOnMe}
          tone="brand"
          onPress={async () => {
            if (loc.permission !== 'granted') {
              if (loc.manual) map.current?.centerOn(loc.manual, { bottom: sheetHeight(0) })
              return
            }
            const p = await loc.locate()
            if (p) map.current?.centerOn(p, { bottom: sheetHeight(0) })
          }}
        />
      </AnimatedView>

      {size.h > 0 && (
        <BottomSheet
          ref={sheet}
          index={0}
          snapPoints={snapPoints}
          enableDynamicSizing={false}
          animatedPosition={sheetPosition}
          backgroundStyle={{ backgroundColor: colors.surface, borderRadius: 24 }}
          handleIndicatorStyle={{ backgroundColor: colors['border-strong'], width: 40, height: 5 }}
          handleStyle={{ height: HANDLE_H, paddingVertical: 10 }}
          style={elevation(3)}
          accessibilityLabel={t.a11y.sheetHandle}
        >
          {topBlock}
          <ResultsList
            ref={list}
            results={pickerOpen && !response ? NO_RESULTS : results}
            unit={unit}
            approximate={response?.routingApproximate ?? false}
            selectedId={search.selectedId}
            onOpen={openStation}
            onRoute={openRoute}
            header={header}
            empty={
              response && response.results.length === 0 ? (
                <EmptyState illustration={<NoStationIllustration />} title={t.search.none} body={t.search.noneBody} />
              ) : null
            }
            renderScrollComponent={scrollable}
          />
        </BottomSheet>
      )}
    </View>
  )
}

function Summary({ label, summary, onEdit }: { label: string; summary: string; onEdit: () => void }) {
  const { colors } = useTheme()
  return (
    <View className="flex-row items-center gap-3">
      <View className="h-11 w-11 items-center justify-center rounded-full bg-primary-subtle">
        <MapPinned size={22} color={colors['primary-subtle-foreground']} />
      </View>
      <View className="flex-1">
        <Text variant="headline" numberOfLines={1}>
          {label}
        </Text>
        <Text variant="footnote" tone="muted" numberOfLines={2} accessibilityLiveRegion="polite">
          {summary}
        </Text>
      </View>
      <Button
        testID="search-edit"
        label={t.search.edit}
        accessibilityLabel={t.search.again}
        icon={SlidersHorizontal}
        variant="outline"
        size="sm"
        onPress={onEdit}
      />
    </View>
  )
}

function TopBar({
  top,
  online,
  mode,
  hasManual,
  permission,
  canAskAgain,
  onUseDevice,
  onAllow,
}: {
  top: number
  online: boolean
  mode: 'device' | 'manual'
  hasManual: boolean
  permission: string
  canAskAgain: boolean
  onUseDevice: () => void
  onAllow: () => void
}) {
  const { colors } = useTheme()
  const denied = permission === 'denied' || permission === 'undetermined'
  return (
    <View pointerEvents="box-none" className="absolute inset-x-0 gap-2 px-4" style={{ top }}>
      <View pointerEvents="box-none" className="flex-row items-center gap-2">
        <View
          className="flex-row items-center gap-2 rounded-full border border-border bg-popover py-2 pl-3 pr-4"
          style={elevation(2)}
        >
          {mode === 'manual' || denied ? (
            <MapPin size={18} color={colors['brand-text']} />
          ) : (
            <LocateFixed size={18} color={colors['brand-text']} />
          )}
          <Text variant="subhead" weight="semibold">
            {mode === 'manual' && hasManual ? t.location.picked : denied ? t.location.denied : t.location.mine}
          </Text>
        </View>
        {/* Point choisi à la main : revenir à la position de l'appareil (ou l'autoriser). */}
        {mode === 'manual' && (permission === 'granted' || hasManual) && (
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t.location.useMine}
            onPress={permission === 'granted' ? onUseDevice : onAllow}
            className="h-10 flex-row items-center gap-1.5 rounded-full bg-primary px-3.5"
            style={elevation(2)}
          >
            <LocateFixed size={16} color={colors['primary-foreground']} />
            <Text variant="subhead" weight="semibold" tone="onPrimary">
              {t.location.useMine}
            </Text>
          </PressableScale>
        )}
      </View>
      {!online && (
        <View
          className="flex-row items-center gap-2 self-start rounded-full bg-foreground px-3 py-1.5"
          accessibilityLiveRegion="polite"
        >
          <WifiOff size={14} color={colors.background} />
          <Text variant="footnote" weight="semibold" style={{ color: colors.background }}>
            {t.common.offline}
          </Text>
        </View>
      )}
      {denied && !hasManual && (
        <View className="rounded-xl border border-border bg-popover p-3" style={elevation(2)}>
          <Text variant="footnote" tone="muted">
            {t.location.deniedBody}
          </Text>
          <View className="mt-2 flex-row">
            <Button
              label={canAskAgain ? t.onboarding.allowLocation : t.location.openSettings}
              size="sm"
              variant="outline"
              icon={LocateFixed}
              onPress={onAllow}
            />
          </View>
        </View>
      )}
    </View>
  )
}
