import { useQuery } from '@tanstack/react-query'
import { router, Tabs } from 'expo-router'
import { useEffect } from 'react'

import { notificationsQuery } from '@/api/account'
import { managerReportsQuery } from '@/api/manager'
import { TabBar } from '@/components/tab-bar'
import { useMe } from '@/features/auth/use-me'
import { useInboxRefetchOnFocus } from '@/features/notifications/availability'
import { usePushPermission } from '@/features/notifications/permission'
import { usePrefs } from '@/stores/prefs'

/** Onglets du gérant approuvé : Stocks (accueil), Ma station, Signalements, Notifications, Compte. */
export default function ManagerTabsLayout() {
  const { me } = useMe()
  // Comme l'espace utilisateur : relue au retour au premier plan quand aucun push ne l'annonce.
  const inbox = useQuery({
    ...notificationsQuery,
    enabled: !!me?.emailVerified,
    refetchInterval: 120_000,
    refetchOnWindowFocus: useInboxRefetchOnFocus(),
  })
  const reports = useQuery({ ...managerReportsQuery('open'), refetchInterval: 300_000 })
  // Juste après la validation de la station : explication des rappels, puis demande d'autorisation
  // (une fois par installation ; jamais au premier lancement).
  const introSeen = usePrefs((s) => s.remindersIntroSeen)
  const permissionKnown = usePushPermission((s) => s.status !== 'unknown')
  useEffect(() => {
    if (!introSeen && permissionKnown) router.push('/manager/reminders')
  }, [introSeen, permissionKnown])
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
