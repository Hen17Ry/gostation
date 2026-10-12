import type { BottomSheetModal } from '@gorhom/bottom-sheet'
import { FlashList } from '@shopify/flash-list'
import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { BellRing, Heart, LogIn } from 'lucide-react-native'
import { useRef, useState } from 'react'
import { RefreshControl, View } from 'react-native'

import { favoritesQuery } from '@/api/account'
import type { Favorite } from '@/api/schemas'
import { Badge } from '@/components/ui/badge'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { FavoritesIllustration } from '@/components/ui/illustrations'
import { PressableScale } from '@/components/ui/pressable-scale'
import { Skeleton } from '@/components/ui/skeleton'
import { TabScreen } from '@/components/ui/tab-screen'
import { Text } from '@/components/ui/text'
import { useRequireAccount } from '@/features/auth/use-require-account'
import { AlertsSheet } from '@/features/favorites/alerts-sheet'
import { useFavorite } from '@/features/favorites/use-favorite'
import { t } from '@/i18n'
import { useTheme } from '@/theme/theme'

/** Favoris : stations suivies, disponibilité, alertes « de retour en stock » par produit. */
export default function Favorites() {
  const { me, ready, ensure } = useRequireAccount()
  const { colors } = useTheme()
  const q = useQuery({ ...favoritesQuery, enabled: ready })
  const sheet = useRef<BottomSheetModal>(null)
  const [editing, setEditing] = useState<Favorite | null>(null)

  if (!ready) {
    return (
      <TabScreen title={t.favorites.title}>
        <EmptyState
          className="flex-1 justify-center pb-24"
          illustration={<FavoritesIllustration />}
          title={me ? t.auth.verifyNeeded : t.favorites.empty}
          body={me ? t.auth.verifyNeededBody : t.favorites.guestBody}
          action={<Button label={me ? t.auth.verifyNow : t.auth.signIn} icon={LogIn} onPress={ensure} />}
        />
      </TabScreen>
    )
  }

  return (
    <TabScreen title={t.favorites.title}>
      {q.isError && !q.data && (
        <View className="px-5">
          <Banner
            tone="danger"
            action={<Button label={t.common.retry} size="sm" variant="outline" onPress={() => q.refetch()} />}
          >
            {t.common.errorTitle}
          </Banner>
        </View>
      )}
      {q.isPending ? (
        <View className="gap-3 px-5 pt-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={96} className="rounded-xl" />
          ))}
        </View>
      ) : (
        <FlashList
          data={q.data ?? []}
          keyExtractor={(f) => f.station.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, paddingTop: 4 }}
          refreshControl={
            <RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} colors={[colors.primary]} />
          }
          ListEmptyComponent={
            <EmptyState
              illustration={<FavoritesIllustration />}
              title={t.favorites.empty}
              body={t.favorites.emptyBody}
            />
          }
          renderItem={({ item }) => (
            <FavoriteRow
              favorite={item}
              onAlerts={() => {
                setEditing(item)
                sheet.current?.present()
              }}
            />
          )}
        />
      )}
      <AlertsSheet ref={sheet} favorite={editing} />
    </TabScreen>
  )
}

function FavoriteRow({ favorite, onAlerts }: { favorite: Favorite; onAlerts: () => void }) {
  const s = favorite.station
  const fav = useFavorite(s.id)
  const alerts = favorite.alertProductIds.length
  return (
    <PressableScale
      scale={0.985}
      accessibilityRole="button"
      accessibilityLabel={[s.name, s.brand, favorite.available ? null : t.favorites.unavailable]
        .filter(Boolean)
        .join(', ')}
      onPress={() => router.push({ pathname: '/station/[id]', params: { id: s.id } })}
      className="mb-3 rounded-xl border border-border bg-card p-4"
    >
      <View className="flex-row items-start gap-2">
        <View className="flex-1 gap-0.5">
          <Text variant="headline" numberOfLines={1}>
            {s.name}
          </Text>
          <Text variant="footnote" tone="muted" numberOfLines={2}>
            {[s.brand, s.address, s.city].filter(Boolean).join(' · ')}
          </Text>
        </View>
        <IconButton
          icon={Heart}
          label={t.station.favoriteRemove}
          selected
          filled
          onPress={fav.toggle}
          disabled={fav.pending}
        />
      </View>
      <View className="mt-2 flex-row items-center justify-between gap-2">
        {favorite.available ? <View /> : <Badge label={t.favorites.unavailable} tone="neutral" />}
        <Button
          label={alerts > 0 ? t.favorites.alertsCount(alerts) : t.favorites.alertsShort}
          accessibilityLabel={t.favorites.alerts}
          icon={BellRing}
          variant={alerts > 0 ? 'secondary' : 'ghost'}
          size="sm"
          disabled={!favorite.available}
          onPress={onAlerts}
        />
      </View>
    </PressableScale>
  )
}
