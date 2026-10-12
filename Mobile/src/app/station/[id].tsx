import { useQuery } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { CalendarX2, Clock3, Flag, Heart, MapPin, Navigation } from 'lucide-react-native'
import { View } from 'react-native'

import { isApiError } from '@/api/errors'
import { stationQuery } from '@/api/public'
import type { PublicStation } from '@/api/schemas'
import { Badge } from '@/components/ui/badge'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { NoStationIllustration } from '@/components/ui/illustrations'
import { Screen } from '@/components/ui/screen'
import { Skeleton } from '@/components/ui/skeleton'
import { Text } from '@/components/ui/text'
import { useRequireAccount } from '@/features/auth/use-require-account'
import { useFavorite } from '@/features/favorites/use-favorite'
import { productLabel } from '@/features/search/product-picker'
import { t } from '@/i18n'
import { cn } from '@/lib/cn'
import { agoFrom, formatQuantity, formatReopening, TIMEZONE } from '@/lib/format'
import { useOnline } from '@/lib/use-online'
import { useTheme } from '@/theme/theme'

/** Fiche station : état, stocks et leur fraîcheur, horaires ; Itinéraire, Favori, Signaler. */
export default function StationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const q = useQuery({ ...stationQuery(id), refetchOnMount: 'always' })
  const fav = useFavorite(id)
  const { ensure } = useRequireAccount()
  const online = useOnline()
  const s = q.data

  if (q.isError && !s) {
    const gone = isApiError(q.error) && q.error.status === 404
    return (
      <Screen>
        <EmptyState
          illustration={<NoStationIllustration />}
          title={gone ? t.station.notFound : t.common.errorTitle}
          body={gone ? undefined : isApiError(q.error) ? q.error.userMessage : undefined}
          action={!gone && <Button label={t.common.retry} variant="outline" onPress={() => q.refetch()} />}
        />
      </Screen>
    )
  }

  return (
    <Screen
      headerRight={
        <IconButton
          testID="station-favorite"
          icon={Heart}
          label={fav.isFavorite ? t.station.favoriteRemove : t.station.favoriteAdd}
          selected={fav.isFavorite}
          filled
          onPress={fav.toggle}
          disabled={!s || fav.pending}
        />
      }
      footer={
        s && (
          <View className="flex-row gap-3">
            <Button
              testID="station-report"
              label={t.station.report}
              icon={Flag}
              variant="outline"
              size="lg"
              className="flex-1"
              onPress={() => ensure() && router.push({ pathname: '/report/[id]', params: { id } })}
            />
            <Button
              testID="station-route"
              label={t.station.route}
              icon={Navigation}
              size="lg"
              className="flex-[1.4]"
              disabled={!s.location}
              onPress={() => router.push({ pathname: '/route/[id]', params: { id } })}
            />
          </View>
        )
      }
    >
      {!s ? (
        <StationSkeleton />
      ) : (
        <>
          {!online && <Banner tone="info">{t.common.offlineBody}</Banner>}
          <Overview s={s} />
          <Stocks s={s} />
          <Hours s={s} />
        </>
      )}
    </Screen>
  )
}

function Overview({ s }: { s: PublicStation }) {
  const { colors } = useTheme()
  const h = s.openingHours
  return (
    <View className="gap-3">
      <View className="gap-1">
        <Text variant="title1" accessibilityRole="header">
          {s.name}
        </Text>
        {s.brand && (
          <Text variant="callout" tone="muted">
            {s.brand}
          </Text>
        )}
      </View>
      <View className="flex-row flex-wrap gap-2">
        {h.isOpenNow ? (
          <Badge label={t.result.open} tone="success" icon={Clock3} />
        ) : (
          <Badge
            label={h.nextOpening ? t.result.closedReopens(formatReopening(h.nextOpening)) : t.result.closed}
            tone="warning"
            icon={Clock3}
          />
        )}
        {s.reported && <Badge label={t.result.reported} tone="danger" icon={Flag} />}
      </View>
      <View className="flex-row items-start gap-2">
        <MapPin size={18} color={colors['muted-foreground']} style={{ marginTop: 2 }} />
        <Text variant="subhead" tone="muted" className="flex-1">
          {[s.address, s.city].filter(Boolean).join(', ')}
        </Text>
      </View>
    </View>
  )
}

const FRESH_TONE = { fresh: 'success', stale: 'warning', expired: 'neutral' } as const

function Stocks({ s }: { s: PublicStation }) {
  return (
    <Card flush className="gap-1">
      <Text variant="headline" className="px-4 pt-4" accessibilityRole="header">
        {t.station.stocks}
      </Text>
      {s.stocks.length === 0 && (
        <Text variant="subhead" tone="muted" className="px-4 pb-4">
          {t.station.noStocks}
        </Text>
      )}
      {s.stocks.map((st, i) => {
        const empty = st.quantity === 0
        const qty =
          st.quantity === null ? t.station.expired : empty ? t.station.outOfStock : formatQuantity(st.unit, st.quantity)
        return (
          <View
            key={st.productId}
            className={cn('flex-row items-center gap-3 px-4 py-3', i > 0 && 'border-t border-border')}
            accessible
            accessibilityLabel={`${productLabel(st)}, ${qty}, ${t.station.freshness[st.freshness]}, ${t.result.updated(agoFrom(st.updatedAt))}${st.reported ? `, ${t.result.reportedHint}` : ''}`}
          >
            <View className="flex-1 gap-0.5">
              <Text variant="body" weight="semibold">
                {productLabel(st)}
              </Text>
              <Text variant="caption" tone="muted">
                {t.result.updated(agoFrom(st.updatedAt))}
              </Text>
            </View>
            <View className="items-end gap-1">
              <Text
                variant="headline"
                tone={st.quantity === null ? 'muted' : empty ? 'destructive' : 'default'}
                className={st.quantity === null ? 'text-footnote' : undefined}
              >
                {qty}
              </Text>
              <View className="flex-row gap-1">
                {st.reported && <Badge label={t.result.reported} tone="danger" />}
                <Badge label={t.station.freshness[st.freshness] ?? st.freshness} tone={FRESH_TONE[st.freshness]} />
              </View>
            </View>
          </View>
        )
      })}
    </Card>
  )
}

const todayIso = () => {
  const d = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short' }).format(new Date())
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(d) + 1
}

function Hours({ s }: { s: PublicStation }) {
  const { colors } = useTheme()
  const h = s.openingHours
  const today = todayIso()
  const byDay = new Map(h.days.map((d) => [d.weekday, d]))
  const dateFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
  return (
    <Card flush className="gap-1">
      <Text variant="headline" className="px-4 pt-4" accessibilityRole="header">
        {t.station.hours}
      </Text>
      {h.days.length === 0 ? (
        <Text variant="subhead" tone="muted" className="px-4 pb-4">
          {t.station.noHours}
        </Text>
      ) : (
        <View className="pb-2">
          {t.station.weekdays.map((name, i) => {
            const day = byDay.get(i + 1)
            const isToday = today === i + 1
            const text = !day
              ? t.station.closedDay
              : day.is24h
                ? t.station.allDay
                : day.ranges.map((r) => `${r.opens} – ${r.closes}`).join(', ')
            return (
              <View
                key={name}
                className={cn('mx-2 flex-row justify-between rounded-md px-2 py-2', isToday && 'bg-primary-subtle')}
                accessible
                accessibilityLabel={`${name}${isToday ? `, ${t.station.today}` : ''} : ${text}`}
              >
                <Text
                  variant="subhead"
                  weight={isToday ? 'semibold' : 'regular'}
                  className={isToday ? 'text-primary-subtle-foreground' : undefined}
                >
                  {name}
                </Text>
                <Text
                  variant="subhead"
                  weight={isToday ? 'semibold' : 'regular'}
                  tone={!day ? 'muted' : 'default'}
                  className={cn('font-mono', isToday && 'text-primary-subtle-foreground')}
                >
                  {text}
                </Text>
              </View>
            )
          })}
        </View>
      )}
      {h.closures.length > 0 && (
        <View className="gap-1.5 border-t border-border px-4 py-3">
          <View className="flex-row items-center gap-2">
            <CalendarX2 size={16} color={colors['warning-subtle-foreground']} />
            <Text variant="subhead" weight="semibold" tone="warning">
              {t.station.closures}
            </Text>
          </View>
          {h.closures.map((d) => (
            <Text key={d} variant="footnote" tone="muted">
              {dateFmt.format(new Date(`${d}T12:00:00Z`))}
            </Text>
          ))}
        </View>
      )}
    </Card>
  )
}

function StationSkeleton() {
  return (
    <View className="gap-4" accessibilityLabel={t.common.loading} accessible>
      <Skeleton height={34} width="70%" />
      <Skeleton height={20} width="40%" />
      <Skeleton height={24} width={120} className="rounded-full" />
      <Skeleton height={180} className="rounded-xl" />
      <Skeleton height={260} className="rounded-xl" />
    </View>
  )
}
