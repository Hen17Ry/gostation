import '../global.css'

import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'

import { ToastHost } from '@/components/ui/toast'
import { useAuthBootstrap } from '@/features/auth/use-auth-bootstrap'
import { bindQueryManagers, createQueryClient, persistOptions } from '@/lib/query-client'
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
  useAuthBootstrap()
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync()
  }, [ready])
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
          <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
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
      <ToastHost />
    </>
  )
}
