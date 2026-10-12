import { useQuery } from '@tanstack/react-query'
import { Tabs } from 'expo-router'

import { notificationsQuery } from '@/api/account'
import { TabBar } from '@/components/tab-bar'
import { useMe } from '@/features/auth/use-me'

export default function TabsLayout() {
  const { me } = useMe()
  const inbox = useQuery({ ...notificationsQuery, enabled: !!me?.emailVerified, refetchInterval: 120_000 })
  const unread = inbox.data?.unreadCount ?? 0
  return (
    <Tabs
      screenOptions={{ headerShown: false, animation: 'fade', lazy: true }}
      tabBar={(props) => <TabBar {...props} badges={{ inbox: unread }} />}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="favorites" />
      <Tabs.Screen name="inbox" />
      <Tabs.Screen name="account" />
    </Tabs>
  )
}
