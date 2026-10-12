import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg'

import { useTheme } from '@/theme/theme'

/**
 * Illustrations des états vides (SVG en ligne, aux tokens, décoratives : le titre porte le sens).
 * Même vocabulaire que le web : disque de marque, traits fins, une touche d'orange.
 */
function useInk() {
  const { colors } = useTheme()
  return {
    disc: colors['primary-subtle'],
    surface: colors.surface,
    line: colors['border-strong'],
    brand: colors.primary,
    onBrand: colors['primary-foreground'],
    shadow: colors['muted'],
  }
}

export function NoStationIllustration({ size = 120 }: { size?: number }) {
  const c = useInk()
  return (
    <Svg
      width={size}
      height={size * 0.8}
      viewBox="0 0 120 96"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Ellipse cx="60" cy="86" rx="40" ry="5" fill={c.shadow} />
      <Circle cx="60" cy="46" r="38" fill={c.disc} />
      <Path d="M22 66l22-8 32 8 22-8" stroke={c.line} strokeWidth="1.5" fill="none" strokeLinejoin="round" />
      <Path
        d="M60 18c-9 0-16 7-16 15.5C44 45 60 60 60 60s16-15 16-26.5C76 25 69 18 60 18Z"
        fill={c.surface}
        stroke={c.brand}
        strokeWidth="1.8"
        strokeDasharray="4 3"
      />
      <Path d="M54 33.5h12" stroke={c.brand} strokeWidth="2.4" strokeLinecap="round" />
    </Svg>
  )
}

export function FavoritesIllustration({ size = 120 }: { size?: number }) {
  const c = useInk()
  return (
    <Svg
      width={size}
      height={size * 0.8}
      viewBox="0 0 120 96"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Ellipse cx="60" cy="86" rx="40" ry="5" fill={c.shadow} />
      <Circle cx="60" cy="46" r="38" fill={c.disc} />
      <Rect x="34" y="24" width="52" height="44" rx="10" fill={c.surface} stroke={c.line} strokeWidth="1.5" />
      <Path d="M60 58s-12-7.2-12-15.2A6.6 6.6 0 0 1 60 39a6.6 6.6 0 0 1 12 3.8C72 50.8 60 58 60 58Z" fill={c.brand} />
    </Svg>
  )
}

export function InboxIllustration({ size = 120 }: { size?: number }) {
  const c = useInk()
  return (
    <Svg
      width={size}
      height={size * 0.8}
      viewBox="0 0 120 96"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Ellipse cx="60" cy="86" rx="40" ry="5" fill={c.shadow} />
      <Circle cx="60" cy="46" r="38" fill={c.disc} />
      <Path
        d="M40 40a20 20 0 0 1 40 0v12l6 8H34l6-8V40Z"
        fill={c.surface}
        stroke={c.line}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <Path d="M54 66a6 6 0 0 0 12 0" stroke={c.line} strokeWidth="1.5" fill="none" />
      <Circle cx="76" cy="30" r="7" fill={c.brand} />
    </Svg>
  )
}

export function OfflineIllustration({ size = 120 }: { size?: number }) {
  const c = useInk()
  return (
    <Svg
      width={size}
      height={size * 0.8}
      viewBox="0 0 120 96"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Ellipse cx="60" cy="86" rx="40" ry="5" fill={c.shadow} />
      <Circle cx="60" cy="46" r="38" fill={c.disc} />
      <Path
        d="M38 46a32 32 0 0 1 44 0M45 54a21 21 0 0 1 30 0M53 62a9 9 0 0 1 14 0"
        stroke={c.line}
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
      <Path d="M40 30l40 40" stroke={c.brand} strokeWidth="2.6" strokeLinecap="round" />
    </Svg>
  )
}

export function CoverageIllustration({ size = 140 }: { size?: number }) {
  const c = useInk()
  return (
    <Svg
      width={size}
      height={size * 0.8}
      viewBox="0 0 120 96"
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <Ellipse cx="60" cy="86" rx="40" ry="5" fill={c.shadow} />
      <Circle cx="60" cy="46" r="38" fill={c.disc} />
      {/* Silhouette simplifiée du Bénin. */}
      <Path
        d="M55 16l9 2 3 9-2 6 5 7-1 9-4 6 1 13-6 6h-6l-1-12 2-8-4-7 1-10 3-7-3-8 3-6Z"
        fill={c.surface}
        stroke={c.brand}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <Circle cx="92" cy="30" r="5" fill={c.line} />
    </Svg>
  )
}
