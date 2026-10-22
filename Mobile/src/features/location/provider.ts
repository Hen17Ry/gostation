import * as Location from 'expo-location'
import { Platform } from 'react-native'

import { hasPlayServices } from '@/lib/play-services'

import nativeLocation, { type GoStationLocationModule, type NativeFix } from '../../../modules/gostation-location'

/**
 * Fournisseurs de position. Tout le code mobile doit marcher sans Google Play Services : beaucoup
 * de téléphones au Bénin (Huawei récents) n'en ont pas, et le fused provider d'expo-location y
 * échoue (SERVICE_INVALID). Avec les services (ou sur iOS) : expo-location ; sans : le
 * LocationManager d'Android, par le module local `modules/gostation-location` (GPS et réseau).
 * Les positions restent en mémoire (règle 2) : rien n'est écrit ni journalisé ici.
 */
export interface Fix {
  lat: number
  lng: number
  /** Rayon de confiance en mètres (null si inconnu). */
  accuracyM: number | null
  heading: number | null
  speed: number | null
  /** Heure de la mesure (ms depuis l'epoch). */
  at: number
}

export type ProviderKind = 'expo' | 'android'

export interface CurrentOptions {
  /** Délai au-delà duquel on renonce (null). */
  timeoutMs: number
  /** Précision qui suffit pour répondre tout de suite. */
  goodAccuracyM: number
  /** Après une première position moins précise : attente d'une meilleure avant de répondre. */
  settleMs: number
  /** Appui de l'utilisateur : Android (services Google) peut proposer d'activer la localisation. */
  interactive?: boolean
}

export interface WatchOptions {
  intervalMs: number
  distanceM: number
}

export interface LocationProvider {
  kind: ProviderKind
  /** Dernière position connue de moins de maxAgeMs, sans nouvelle mesure. */
  lastKnown(maxAgeMs: number): Promise<Fix | null>
  /** Nouvelle mesure ; null si aucune dans le délai, localisation coupée ou refusée. */
  current(opts: CurrentOptions): Promise<Fix | null>
  /** Localisation du téléphone activée (réglage du système). */
  servicesEnabled(): Promise<boolean>
  /** Suivi continu (guidage). */
  watch(opts: WatchOptions, onFix: (fix: Fix) => void): Promise<{ remove(): void }>
}

interface Env {
  os: string
  hasPlayServices: boolean
  hasNativeModule: boolean
}

/**
 * Choix du fournisseur. Android sans services Google : LocationManager. Sinon expo-location (fused
 * provider sur Android, Core Location sur iOS), y compris si le module local manquait.
 */
export function chooseProvider(env: Env): ProviderKind {
  return env.os === 'android' && env.hasNativeModule && !env.hasPlayServices ? 'android' : 'expo'
}

const fromExpo = (l: Location.LocationObject): Fix => ({
  lat: l.coords.latitude,
  lng: l.coords.longitude,
  accuracyM: l.coords.accuracy ?? null,
  heading: l.coords.heading ?? null,
  speed: l.coords.speed ?? null,
  at: l.timestamp,
})

const fromNative = (l: NativeFix): Fix => ({
  lat: l.latitude,
  lng: l.longitude,
  accuracyM: l.accuracy,
  heading: l.heading,
  speed: l.speed,
  at: l.timestamp,
})

/** Promesse coupée à `ms` (null) ; la mesure en cours s'arrête d'elle-même côté système. */
export function withTimeout<T>(p: Promise<T | null>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const id = setTimeout(() => resolve(null), ms)
    p.then(
      (v) => {
        clearTimeout(id)
        resolve(v)
      },
      () => {
        clearTimeout(id)
        resolve(null)
      },
    )
  })
}

/** expo-location : fused provider (Android avec services Google) ou Core Location (iOS). */
export function expoProvider(): LocationProvider {
  const attempt = (accuracy: Location.Accuracy, dialog: boolean) =>
    Location.getCurrentPositionAsync({ accuracy, mayShowUserSettingsDialog: dialog }).catch(() => null)
  return {
    kind: 'expo',
    lastKnown: async (maxAge) => {
      const l = await Location.getLastKnownPositionAsync({ maxAge }).catch(() => null)
      return l ? fromExpo(l) : null
    },
    // Mesure silencieuse (réseau, puis GPS) ; en dernier recours, sur appui, Android peut
    // proposer d'activer la précision de la localisation.
    current: async ({ timeoutMs, interactive }) => {
      const l = await withTimeout(
        (async () =>
          (await attempt(Location.Accuracy.Balanced, false)) ??
          (await attempt(Location.Accuracy.High, false)) ??
          (interactive ? await attempt(Location.Accuracy.Balanced, true) : null))(),
        timeoutMs,
      )
      return l ? fromExpo(l) : null
    },
    servicesEnabled: () => Location.hasServicesEnabledAsync(),
    watch: async ({ intervalMs, distanceM }, onFix) =>
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, distanceInterval: distanceM, timeInterval: intervalMs },
        (l) => onFix(fromExpo(l)),
      ),
  }
}

/** LocationManager d'Android (module local) : téléphones sans services Google. */
export function androidProvider(native: GoStationLocationModule): LocationProvider {
  let nextWatchId = 1
  return {
    kind: 'android',
    lastKnown: async (maxAge) => {
      const l = await native.getLastKnownPosition(maxAge).catch(() => null)
      return l ? fromNative(l) : null
    },
    current: async ({ timeoutMs, goodAccuracyM, settleMs }) => {
      // Le délai natif répond avec la meilleure position reçue ; le nôtre (marge d'1 s) couvre un
      // module qui ne répondrait pas.
      const l = await withTimeout(native.getCurrentPosition({ timeoutMs, goodAccuracyM, settleMs }), timeoutMs + 1_000)
      return l ? fromNative(l) : null
    },
    servicesEnabled: async () => {
      try {
        return native.getProviderStatus().locationEnabled
      } catch {
        return true
      }
    },
    watch: async (opts, onFix) => {
      const id = nextWatchId++
      const sub = native.addListener('onLocation', (e) => {
        if (e.watchId === id) onFix(fromNative(e.location))
      })
      native.startWatching(id, opts)
      return {
        remove: () => {
          native.stopWatching(id)
          sub.remove()
        },
      }
    },
  }
}

let provider: LocationProvider | null = null

/** Fournisseur de cette installation, choisi au premier usage. */
export function locationProvider(): LocationProvider {
  provider ??=
    chooseProvider({ os: Platform.OS, hasPlayServices: hasPlayServices(), hasNativeModule: !!nativeLocation }) ===
      'android' && nativeLocation
      ? androidProvider(nativeLocation)
      : expoProvider()
  return provider
}
