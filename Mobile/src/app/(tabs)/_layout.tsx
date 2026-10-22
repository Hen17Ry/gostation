import { useQuery } from '@tanstack/react-query'
import { Redirect, Tabs } from 'expo-router'

import { notificationsQuery } from '@/api/account'
import { TabBar } from '@/components/tab-bar'
import { useMe } from '@/features/auth/use-me'
import { SPACE_HOME, useSpace } from '@/features/manager/space'
import { useInboxRefetchOnFocus } from '@/features/notifications/availability'

export default function TabsLayout() {
  const { me } = useMe()
  const space = useSpace()
  // Relue à l'ouverture (montage), toutes les 2 min, et au retour au premier plan si aucun push ne
  // peut l'annoncer (téléphone sans services Google, notifications refusées).
  const inbox = useQuery({
    ...notificationsQuery,
    enabled: !!me?.emailVerified && space === 'user',
    refetchInterval: 120_000,
    refetchOnWindowFocus: useInboxRefetchOnFocus(),
  })
  // Gérant ouvert sur « / » (lancement) : redirigé avant tout rendu, sans créer la carte de recherche
  // ni charger ses tuiles (la garde de la pile racine ne s'applique qu'après ce premier rendu).
  if (space !== 'user') return <Redirect href={SPACE_HOME[space]} />
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
