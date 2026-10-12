import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg'

import { artColors } from '@/theme/illustration'
import { useTheme } from '@/theme/theme'

/**
 * Illustrations de l'accueil (SVG aux tokens, décoratives). Même grammaire visuelle : disque de
 * marque, carte stylisée, épingles GoStation.
 */
function useInk() {
  const { colors, scheme } = useTheme()
  return {
    disc: colors['primary-subtle'],
    paper: colors.surface,
    road: artColors[scheme].road,
    land: artColors[scheme].land,
    water: artColors[scheme].water,
    line: colors['border-strong'],
    brand: colors.primary,
    brandDeep: colors['brand-text'],
    onBrand: colors['primary-foreground'],
    good: colors['status-good'],
    muted: colors['muted-foreground'],
  }
}

const Pin = ({
  x,
  y,
  color,
  inner,
  scale = 1,
}: {
  x: number
  y: number
  color: string
  inner: string
  scale?: number
}) => (
  <G transform={`translate(${x} ${y}) scale(${scale})`}>
    <Path d="M0 -30c-9.4 0-17 7.3-17 16.4C-17 -1.6 0 14 0 14s17-15.6 17-27.6C17 -22.7 9.4 -30 0 -30Z" fill={color} />
    <Circle cx="0" cy="-13.5" r="6.5" fill={inner} />
  </G>
)

export function FindArt({ size = 260 }: { size?: number }) {
  const c = useInk()
  return (
    <Svg width={size} height={size} viewBox="0 0 260 260" accessibilityElementsHidden importantForAccessibility="no">
      <Defs>
        <LinearGradient id="ob-glow" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={c.brand} stopOpacity="0.22" />
          <Stop offset="1" stopColor={c.brand} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      <Circle cx="130" cy="130" r="118" fill={c.disc} />
      <G>
        <Rect x="38" y="52" width="184" height="156" rx="22" fill={c.land} />
        <Path
          d="M38 150c40-14 70 10 110-4s52-30 74-26v66a22 22 0 0 1-22 22H60a22 22 0 0 1-22-22Z"
          fill={c.water}
          opacity="0.9"
        />
        <Path d="M60 52l40 156M38 112h184M150 52c-6 50 22 90 14 156" stroke={c.road} strokeWidth="9" fill="none" />
        <Path
          d="M60 52l40 156M38 112h184M150 52c-6 50 22 90 14 156"
          stroke={c.line}
          strokeWidth="1"
          fill="none"
          opacity="0.6"
        />
      </G>
      <Circle cx="152" cy="112" r="52" fill="url(#ob-glow)" />
      <Circle
        cx="152"
        cy="112"
        r="40"
        stroke={c.brand}
        strokeWidth="1.5"
        strokeDasharray="4 5"
        fill="none"
        opacity="0.6"
      />
      <Pin x={96} y={104} color={c.muted} inner={c.paper} scale={0.7} />
      <Pin x={196} y={160} color={c.muted} inner={c.paper} scale={0.7} />
      <Pin x={152} y={118} color={c.brand} inner={c.onBrand} scale={1.15} />
      {/* Pastille « en stock » */}
      <G transform="translate(168 60)">
        <Rect width="64" height="26" rx="13" fill={c.paper} />
        <Circle cx="14" cy="13" r="5" fill={c.good} />
        <Rect x="25" y="9" width="28" height="8" rx="4" fill={c.line} />
      </G>
    </Svg>
  )
}

export function PrivacyArt({ size = 260 }: { size?: number }) {
  const c = useInk()
  return (
    <Svg width={size} height={size} viewBox="0 0 260 260" accessibilityElementsHidden importantForAccessibility="no">
      <Circle cx="130" cy="130" r="118" fill={c.disc} />
      <Circle cx="130" cy="130" r="86" stroke={c.brand} strokeWidth="1.5" fill="none" opacity="0.25" />
      <Circle cx="130" cy="130" r="58" stroke={c.brand} strokeWidth="1.5" fill="none" opacity="0.45" />
      <Circle cx="130" cy="130" r="30" fill={c.brand} opacity="0.18" />
      <Circle cx="130" cy="130" r="13" fill={c.brand} />
      <Circle cx="130" cy="130" r="5" fill={c.onBrand} />
      {/* Bouclier : la position n'est pas conservée */}
      <G transform="translate(170 150)">
        <Path
          d="M30 0l28 10v20c0 20-12 34-28 40C14 64 2 50 2 30V10Z"
          fill={c.paper}
          stroke={c.line}
          strokeWidth="1.5"
        />
        <Path
          d="M18 33l9 9 17-19"
          stroke={c.good}
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </G>
    </Svg>
  )
}

export function NoAccountArt({ size = 260 }: { size?: number }) {
  const c = useInk()
  return (
    <Svg width={size} height={size} viewBox="0 0 260 260" accessibilityElementsHidden importantForAccessibility="no">
      <Circle cx="130" cy="130" r="118" fill={c.disc} />
      {/* Téléphone */}
      <Rect x="78" y="40" width="104" height="184" rx="20" fill={c.paper} stroke={c.line} strokeWidth="1.5" />
      <Rect x="88" y="56" width="84" height="96" rx="10" fill={c.land} />
      <Path d="M88 116c22-8 40 6 84-6" stroke={c.road} strokeWidth="7" fill="none" />
      <Pin x={130} y={108} color={c.brand} inner={c.onBrand} scale={0.85} />
      <Rect x="88" y="162" width="84" height="16" rx="8" fill={c.brand} />
      <Rect x="96" y="188" width="46" height="8" rx="4" fill={c.line} />
      <Rect x="96" y="202" width="30" height="8" rx="4" fill={c.line} />
      {/* Éclair : immédiat */}
      <G transform="translate(176 54)">
        <Circle cx="22" cy="22" r="22" fill={c.brand} />
        <Path d="M25 9l-12 16h9l-3 12 12-17h-9Z" fill={c.onBrand} />
      </G>
    </Svg>
  )
}
