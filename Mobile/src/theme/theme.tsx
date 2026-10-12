import { vars } from 'nativewind'
import { createContext, type ReactNode, use } from 'react'
import { useColorScheme, View } from 'react-native'

import { type ColorRole, tokens } from './tokens.generated'

export type Scheme = 'light' | 'dark'
export type Colors = Record<ColorRole, string>

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

/** Variables NativeWind des rôles (`bg-primary` → rgb(var(--primary))), une table par thème. */
const themeVars = {
  light: vars(Object.fromEntries(Object.entries(tokens.light).map(([k, v]) => [`--${k}`, rgb(v)]))),
  dark: vars(Object.fromEntries(Object.entries(tokens.dark).map(([k, v]) => [`--${k}`, rgb(v)]))),
}

const ThemeContext = createContext<{ scheme: Scheme; colors: Colors }>({ scheme: 'light', colors: tokens.light })

/**
 * Thème clair ou sombre selon le système (pas de bascule dans l'app en V1). Les composants
 * utilisent les classes sémantiques ; `useTheme().colors` (hex) sert là où une classe ne
 * s'applique pas (carte, barres système, icônes, animations).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme: Scheme = useColorScheme() === 'dark' ? 'dark' : 'light'
  return (
    <ThemeContext value={{ scheme, colors: tokens[scheme] }}>
      <View style={[{ flex: 1 }, themeVars[scheme]]}>{children}</View>
    </ThemeContext>
  )
}

export const useTheme = () => use(ThemeContext)

/** Ajoute une opacité à une couleur hex (#rrggbb → #rrggbbaa). */
export const alpha = (hex: string, a: number) =>
  `${hex}${Math.round(Math.min(1, Math.max(0, a)) * 255)
    .toString(16)
    .padStart(2, '0')}`
