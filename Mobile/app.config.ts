/// <reference types="node" />
// Lu par Node (Expo CLI, Gradle, EAS), jamais embarqué dans l'app : types Node pour ce seul fichier.
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { ExpoConfig } from 'expo/config'

/**
 * Configuration Expo (CNG : android/ et ios/ sont générés par `expo prebuild`, jamais commités).
 * Identifiant bj.gostation.app sur Android et iOS ; Android d'abord. Aucune valeur secrète ici :
 * seules les variables EXPO_PUBLIC_* (publiques) sont lues par l'app.
 */
const FONTS = [
  'node_modules/@expo-google-fonts/geist/400Regular/Geist_400Regular.ttf',
  'node_modules/@expo-google-fonts/geist/500Medium/Geist_500Medium.ttf',
  'node_modules/@expo-google-fonts/geist/600SemiBold/Geist_600SemiBold.ttf',
  'node_modules/@expo-google-fonts/geist/700Bold/Geist_700Bold.ttf',
  'node_modules/@expo-google-fonts/geist-mono/500Medium/GeistMono_500Medium.ttf',
]

const LOCAL_API = /^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(process.env.EXPO_PUBLIC_API_URL ?? '')

// Configuration Firebase (FCM, push Android), jamais commitée (Mobile/.gitignore). Build EAS : variable
// d'environnement EAS de type fichier GOOGLE_SERVICES_JSON (EAS y met le chemin du fichier). En local :
// Mobile/google-services.json, s'il existe ; sinon le build se fait sans Firebase.
const LOCAL_GOOGLE_SERVICES = join(__dirname, 'google-services.json')
const GOOGLE_SERVICES_FILE =
  process.env.GOOGLE_SERVICES_JSON ?? (existsSync(LOCAL_GOOGLE_SERVICES) ? './google-services.json' : undefined)

const config: ExpoConfig = {
  name: 'GoStation',
  slug: 'gostation',
  // Projet EAS (builds, credentials FCM, EAS Update) : https://expo.dev/accounts/hen_ry/projects/gostation
  owner: 'hen_ry',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'gostation',
  userInterfaceStyle: 'automatic',
  icon: './assets/images/icon.png',
  backgroundColor: '#fbfaf9',
  ios: {
    bundleIdentifier: 'bj.gostation.app',
    supportsTablet: false,
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'GoStation utilise votre position pour trouver la station la plus proche qui a votre produit en stock et vous y guider. Elle n’est jamais enregistrée.',
    },
  },
  android: {
    package: 'bj.gostation.app',
    ...(GOOGLE_SERVICES_FILE && { googleServicesFile: GOOGLE_SERVICES_FILE }),
    adaptiveIcon: {
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundColor: '#d14200',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    // Seules les permissions utiles : position (premier plan), réseau, appareil photo (justificatif du
    // gérant). Pas de stockage (fichiers par le sélecteur du système) ni de micro.
    permissions: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'CAMERA'],
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-localization',
    ['expo-font', { fonts: FONTS }],
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 120,
        backgroundColor: '#fbfaf9',
        dark: { image: './assets/images/splash-icon.png', backgroundColor: '#0b0a09' },
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'GoStation utilise votre position pour trouver la station la plus proche qui a votre produit en stock et vous y guider. Elle n’est jamais enregistrée.',
        isAndroidBackgroundLocationEnabled: false,
        isIosBackgroundLocationEnabled: false,
      },
    ],
    '@maplibre/maplibre-react-native',
    // Justificatif du gérant : photo prise avec l'appareil (les fichiers passent par le sélecteur
    // du système, sans permission de stockage).
    [
      'expo-image-picker',
      {
        cameraPermission:
          'GoStation utilise l’appareil photo pour photographier le justificatif de votre station (IFU, RCCM).',
        photosPermission: false,
        microphonePermission: false,
      },
    ],
    // Heures et dates des horaires (sélecteurs natifs).
    '@react-native-community/datetimepicker',
    // Méthodes Java/Kotlin du parcours principal précompilées à l'installation (images perdues sinon).
    './plugins/with-baseline-profile',
    [
      'expo-build-properties',
      {
        // Cible : Android d'entrée de gamme. APK plus léger en release (R8 + ressources).
        // HTTP en clair seulement pour une API locale (build de test : adb reverse vers l'hôte) ;
        // en production l'URL est en https et le trafic en clair reste interdit.
        android: {
          enableMinifyInReleaseBuilds: true,
          enableShrinkResourcesInReleaseBuilds: true,
          usesCleartextTraffic: LOCAL_API,
        },
      },
    ],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
  extra: {
    router: {},
    eas: { projectId: 'da725901-6ce3-49d5-bd36-5df2d9a716a1' },
  },
}

export default config
