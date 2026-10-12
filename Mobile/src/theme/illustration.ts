import { tokens } from './tokens.generated'

/**
 * Couleurs « carte » des illustrations (routes, terre, eau), alignées sur le style de carte
 * GoStation (scripts/gen-map-styles.mts) pour que l'accueil annonce la vraie carte.
 */
export const artColors = {
  light: { road: '#ffffff', land: '#efedea', water: '#c6d5dc' },
  dark: { road: '#3a3532', land: tokens.neutral[900], water: '#0d171c' },
} as const

/** Marqueurs des stations fermées (gris neutre, texte clair). */
export const closedMarker = {
  light: { fill: tokens.neutral[600], text: tokens.neutral[50] },
  dark: { fill: tokens.neutral[500], text: tokens.neutral[50] },
} as const
