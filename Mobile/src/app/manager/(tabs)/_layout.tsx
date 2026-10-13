import { useQuery } from '@tanstack/react-query'
import { Tabs } from 'expo-router'

import { notificationsQuery } from '@/api/account'
import { managerReportsQuery } from '@/api/manager'
import { TabBar } from '@/components/tab-bar'
import { useMe } from '@/features/auth/use-me'

/** Onglets du gérant approuvé : Stocks (accueil), Ma station, Signalements, Notifications, Compte. */
export default function ManagerTabsLayout() {
  const { me } = useMe()
  const inbox = useQuery({ ...notificationsQuery, enabled: !!me?.emailVerified, refetchInterval: 120_000 })
  const reports = useQuery({ ...managerReportsQuery('open'), refetchInterval: 300_000 })
  return (
    <Tabs
      screenOptions={{ headerShown: false, animation: 'fade', lazy: true }}
      tabBar={(props) => (
        <TabBar {...props} badges={{ inbox: inbox.data?.unreadCount ?? 0, reports: reports.data?.flags.length ?? 0 }} />
      )}
    >
      <Tabs.Screen name="stocks" />
      <Tabs.Screen name="station" />
      <Tabs.Screen name="reports" />
      <Tabs.Screen name="inbox" />
      <Tabs.Screen name="account" />
    </Tabs>
  )
}
