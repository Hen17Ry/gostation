import { FlashList } from '@shopify/flash-list'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { BellRing, CheckCheck, Flag, LogIn, PackageCheck } from 'lucide-react-native'
import { RefreshControl, View } from 'react-native'

import { markNotificationsRead, notificationsQuery } from '@/api/account'
import { meKeys } from '@/api/keys'
import type { Notification } from '@/api/schemas'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { InboxIllustration } from '@/components/ui/illustrations'
import { PressableScale } from '@/components/ui/pressable-scale'
import { Skeleton } from '@/components/ui/skeleton'
import { TabScreen } from '@/components/ui/tab-screen'
import { Text } from '@/components/ui/text'
import { useRequireAccount } from '@/features/auth/use-require-account'
import { notificationStationId, notificationText } from '@/features/inbox/notification-text'
import { t } from '@/i18n'
import { cn } from '@/lib/cn'
import { agoFrom } from '@/lib/format'
import { useTheme } from '@/theme/theme'

const ICONS = { back_in_stock: PackageCheck, station_reported: Flag, stock_reminder: BellRing }

/** Boîte de réception (30 jours) : texte composé sur l'appareil, non lues mises en avant. */
export default function Inbox() {
  const { me, ready, ensure } = useRequireAccount()
  const qc = useQueryClient()
  const { colors } = useTheme()
  const q = useQuery({ ...notificationsQuery, enabled: ready })
  const read = useMutation({
    mutationFn: markNotificationsRead,
    onSettled: () => qc.invalidateQueries({ queryKey: meKeys.notifications() }),
  })

  if (!ready) {
    return (
      <TabScreen title={t.inbox.title}>
        <EmptyState
          className="flex-1 justify-center pb-24"
          illustration={<InboxIllustration />}
          title={me ? t.auth.verifyNeeded : t.inbox.empty}
          body={me ? t.auth.verifyNeededBody : t.inbox.guestBody}
          action={<Button label={me ? t.auth.verifyNow : t.auth.signIn} icon={LogIn} onPress={ensure} />}
        />
      </TabScreen>
    )
  }

  const unread = q.data?.unreadCount ?? 0
  const open = (n: Notification) => {
    if (!n.readAt) read.mutate({ ids: [n.id] })
    const stationId = notificationStationId(n)
    if (stationId && n.type === 'back_in_stock') router.push({ pathname: '/station/[id]', params: { id: stationId } })
  }

  return (
    <TabScreen
      title={t.inbox.title}
      action={
        unread > 0 && (
          <Button
            label={t.inbox.markAllRead}
            icon={CheckCheck}
            variant="ghost"
            size="sm"
            onPress={() => read.mutate({ all: true })}
          />
        )
      }
    >
      {q.isPending ? (
        <View className="gap-3 px-5 pt-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={72} className="rounded-xl" />
          ))}
        </View>
      ) : (
        <FlashList
          data={q.data?.items ?? []}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24, paddingTop: 4 }}
          refreshControl={
            <RefreshControl refreshing={q.isRefetching} onRefresh={() => q.refetch()} colors={[colors.primary]} />
          }
          ListEmptyComponent={
            <EmptyState illustration={<InboxIllustration />} title={t.inbox.empty} body={t.inbox.emptyBody} />
          }
          renderItem={({ item }) => {
            const Icon = ICONS[item.type] ?? BellRing
            const text = notificationText(item)
            const unreadItem = !item.readAt
            return (
              <PressableScale
                scale={0.985}
                accessibilityRole="button"
                accessibilityLabel={`${unreadItem ? `${t.inbox.unread}. ` : ''}${text}, ${agoFrom(item.createdAt)}`}
                onPress={() => open(item)}
                className={cn(
                  'mb-2 flex-row gap-3 rounded-xl border p-4',
                  unreadItem ? 'border-primary/40 bg-primary-subtle' : 'border-border bg-card',
                )}
              >
                <View
                  className={cn(
                    'h-10 w-10 items-center justify-center rounded-full',
                    unreadItem ? 'bg-primary' : 'bg-muted',
                  )}
                >
                  <Icon size={20} color={unreadItem ? colors['primary-foreground'] : colors['muted-foreground']} />
                </View>
                <View className="flex-1 gap-1">
                  <Text variant="subhead" weight={unreadItem ? 'semibold' : 'regular'}>
                    {text}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {agoFrom(item.createdAt)}
                  </Text>
                </View>
                {unreadItem && <View className="mt-1.5 h-2.5 w-2.5 rounded-full bg-primary" />}
              </PressableScale>
            )
          }}
        />
      )}
    </TabScreen>
  )
}
