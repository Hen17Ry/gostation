import { Stack } from 'expo-router'

import { useMe } from '@/features/auth/use-me'
import { useSpace } from '@/features/manager/space'
import { useTheme } from '@/theme/theme'

/**
 * Espace gérant (D58) : station approuvée → onglets (stocks, station, signalements…) et écrans de
 * configuration ; dossier en attente, rejeté ou suspendu → écran de statut (et, après un rejet,
 * correction et nouveau justificatif). Un lien vers un écran de l'autre groupe mène à l'accueil.
 */
export default function ManagerLayout() {
  const { colors } = useTheme()
  const space = useSpace()
  const { me } = useMe()
  const rejected = me?.station?.status === 'rejected'
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
        animation: 'ios_from_right',
      }}
    >
      <Stack.Protected guard={space === 'manager'}>
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="location" options={{ animation: 'fade_from_bottom' }} />
        <Stack.Screen name="hours" />
        <Stack.Screen name="products" />
        <Stack.Screen name="search" options={{ animation: 'fade_from_bottom' }} />
      </Stack.Protected>
      <Stack.Protected guard={space === 'manager-status'}>
        <Stack.Screen name="status" options={{ animation: 'fade' }} />
        <Stack.Protected guard={rejected}>
          <Stack.Screen name="edit" />
          <Stack.Screen name="resubmit" />
        </Stack.Protected>
      </Stack.Protected>
    </Stack>
  )
}
