import '../global.css'

import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { Stack, usePathname } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { ToastHost } from '@/components/ui/toast'
import { useAuthBootstrap } from '@/features/auth/use-auth-bootstrap'
import { useSpace } from '@/features/manager/space'
import { NotificationsRuntime } from '@/features/notifications/runtime'
import { bindQueryManagers, createQueryClient, persistOptions } from '@/lib/query-client'
import { splashReady } from '@/lib/splash'
import { configureMapCache } from '@/map/config'
import { useAuth } from '@/stores/auth'
import { usePrefs } from '@/stores/prefs'
import { ThemeProvider, useTheme } from '@/theme/theme'

void SplashScreen.preventAutoHideAsync()
SplashScreen.setOptions({ fade: true, duration: 180 })

const queryClient = createQueryClient()
bindQueryManagers()
configureMapCache()

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
            <BottomSheetModalProvider>
              <Root />
            </BottomSheetModalProvider>
            {/* Après les panneaux (portail du fournisseur) : un toast reste au-dessus de leur voile. */}
            <ToastHost />
          </PersistQueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

function Root() {
  const { scheme, colors } = useTheme()
  const onboarded = usePrefs((s) => s.onboarded)
  const ready = useAuth((s) => s.status !== 'unknown')
  const pathname = usePathname()
  // Espace selon le compte (D58) : utilisateur (onglets de recherche) ou gérant (stocks, ou statut).
  const space = useSpace()
  useAuthBootstrap()
  // Démarrage sur la carte : l'écran de démarrage attend aussi sa première image (src/lib/splash.ts).
  useEffect(() => {
    if (!ready) return
    splashReady('session')
    if (!onboarded || pathname !== '/') splashReady('map')
  }, [ready, onboarded, pathname])
  if (!ready) return null
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          animation: 'ios_from_right',
        }}
      >
        <Stack.Protected guard={!onboarded}>
          <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
        </Stack.Protected>
        <Stack.Protected guard={onboarded}>
          <Stack.Protected guard={space === 'user'}>
            <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
          </Stack.Protected>
          <Stack.Protected guard={space !== 'user'}>
            <Stack.Screen name="manager" options={{ animation: 'fade' }} />
          </Stack.Protected>
          <Stack.Screen name="station/[id]" />
          <Stack.Screen name="route/[id]" options={{ animation: 'fade_from_bottom', gestureEnabled: false }} />
          <Stack.Screen name="report/[id]" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="auth" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="profile" />
          <Stack.Screen name="out-of-coverage" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack.Protected>
        <Stack.Screen name="legal" />
        <Stack.Protected guard={__DEV__}>
          <Stack.Screen name="design" />
        </Stack.Protected>
      </Stack>
      <NotificationsRuntime />
    </>
  )
}
