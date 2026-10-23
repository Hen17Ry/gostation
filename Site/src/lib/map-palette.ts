/**
 * Palette des cartes : celle de l'app (Mobile/scripts/gen-map-styles.mts, recoloration d'OpenFreeMap),
 * pour que la ville du site ressemble à la carte de l'app : claire sur l'écran du téléphone, sombre
 * pour la nuit des scènes 2 à 4. map-palette.test.ts vérifie que les valeurs n'ont pas divergé.
 */
import { palette } from './tokens.generated'

const n = palette.neutral
const b = palette.brand

export const mapPalette = {
  light: {
    background: n[100],
    water: '#c6d5dc',
    minor: '#ffffff',
    majorCasing: n[300],
    majorInner: '#ffffff',
    motorwayCasing: b[200],
    motorwayInner: b[50],
    label: n[700],
  },
  dark: {
    background: '#100e0d',
    water: '#0d171c',
    minor: '#2a2624',
    majorCasing: '#1c1917',
    majorInner: '#3a3532',
    motorwayCasing: '#2a160c',
    motorwayInner: '#5a2c12',
    label: n[300],
  },
} as const

export type MapTheme = keyof typeof mapPalette
