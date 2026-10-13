import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg'

import { tokens } from '@/theme/tokens.generated'

/**
 * Marque GoStation (la même que l'admin web) : épingle de station + éclair, sur pastille orange
 * (dégradé 500 → 700 pour la profondeur). Décorative : le nom de l'app est lu à côté.
 */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" accessibilityElementsHidden importantForAccessibility="no">
      <Defs>
        <LinearGradient id="gs-mark" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={tokens.brand[500]} />
          <Stop offset="1" stopColor={tokens.brand[700]} />
        </LinearGradient>
      </Defs>
      <Rect width="32" height="32" rx="8" fill="url(#gs-mark)" />
      <Path
        d="M16 6.5c-4 0-7.2 3.1-7.2 7 0 5.1 6.1 10.9 6.6 11.4a.9.9 0 0 0 1.2 0c.5-.5 6.6-6.3 6.6-11.4 0-3.9-3.2-7-7.2-7Z"
        fill={tokens.light['primary-foreground']}
      />
      <Path d="M16.9 9.6l-3.2 4.6h2.4l-.9 3.9 3.3-4.9h-2.5l.9-3.6Z" fill={tokens.brand[600]} />
    </Svg>
  )
}
