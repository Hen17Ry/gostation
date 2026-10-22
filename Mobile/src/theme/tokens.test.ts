/**
 * Contrastes WCAG AA des couples de tokens utilisés par les composants mobiles, en clair et en
 * sombre : 4,5:1 pour le texte, 3:1 pour les composants d'interface et les grands textes.
 */
import { closedMarker } from './illustration'
import { tokens } from './tokens.generated'

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

type Role = keyof typeof tokens.light
const TEXT: [Role, Role][] = [
  ['foreground', 'background'],
  ['foreground', 'surface'],
  ['popover-foreground', 'popover'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'surface'],
  ['muted-foreground', 'muted'],
  ['muted-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['brand-text', 'background'],
  ['brand-text', 'surface'],
  ['primary-subtle-foreground', 'primary-subtle'],
  ['secondary-foreground', 'secondary'],
  ['destructive', 'surface'],
  ['destructive-foreground', 'destructive'],
  ['success-subtle-foreground', 'success-subtle'],
  ['success-subtle-foreground', 'popover'],
  ['warning-subtle-foreground', 'warning-subtle'],
  ['warning-subtle-foreground', 'card'],
  ['danger-subtle-foreground', 'danger-subtle'],
  ['info-subtle-foreground', 'info-subtle'],
  // Bandeau « Staging » (src/components/staging-frame.tsx).
  ['info-foreground', 'info'],
  ['background', 'foreground'],
]
const UI: [Role, Role][] = [
  ['input', 'surface'],
  ['ring', 'background'],
  ['primary', 'surface'],
  ['primary', 'background'],
]

describe.each(['light', 'dark'] as const)('contrastes (%s)', (scheme) => {
  const c = tokens[scheme]
  it.each(TEXT)('texte %s sur %s ≥ 4,5:1', (fg, bg) => {
    expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(4.5)
  })
  it.each(UI)('composant %s sur %s ≥ 3:1', (fg, bg) => {
    expect(contrast(c[fg], c[bg])).toBeGreaterThanOrEqual(3)
  })
  it('numéro des stations fermées sur leur marqueur ≥ 4,5:1', () => {
    expect(contrast(closedMarker[scheme].text, closedMarker[scheme].fill)).toBeGreaterThanOrEqual(4.5)
  })
})
