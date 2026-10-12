/**
 * Couleurs : lecture des formats CSS utilisés par les tokens (oklch, rgb, hex), luminance et
 * contraste WCAG 2.x. Sert au test des tokens et à la page /design (contrastes en direct).
 */
export type Rgba = { r: number; g: number; b: number; a: number } // linéaire 0..1

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

function oklchToLinear(L: number, C: number, H: number) {
  const h = (H * Math.PI) / 180
  const a = C * Math.cos(h)
  const b = C * Math.sin(h)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return {
    r: clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  }
}

const num = (v: string) => (v.endsWith('%') ? parseFloat(v) / 100 : parseFloat(v))

/** Lit oklch(L C H [/ a]), rgb()/rgba(), color(srgb …) et #rgb/#rrggbb. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase()
  let m = s.match(/^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*([\d.]+%?))?\s*\)$/)
  if (m) {
    const { r, g, b } = oklchToLinear(num(m[1]!), parseFloat(m[2]!), parseFloat(m[3]!))
    return { r, g, b, a: m[4] ? num(m[4]) : 1 }
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/)
  if (m) {
    return {
      r: toLinear(parseFloat(m[1]!) / 255),
      g: toLinear(parseFloat(m[2]!) / 255),
      b: toLinear(parseFloat(m[3]!) / 255),
      a: m[4] ? num(m[4]) : 1,
    }
  }
  m = s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\)$/)
  if (m) {
    return { r: toLinear(+m[1]!), g: toLinear(+m[2]!), b: toLinear(+m[3]!), a: m[4] ? num(m[4]) : 1 }
  }
  m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (m) {
    const hex = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!
    const [r, g, b] = [0, 2, 4].map((i) => toLinear(parseInt(hex.slice(i, i + 2), 16) / 255))
    return { r: r!, g: g!, b: b!, a: 1 }
  }
  return null
}

/** Compose une couleur translucide sur un fond opaque (en sRGB gamma, comme le navigateur). */
export function over(top: Rgba, bottom: Rgba): Rgba {
  if (top.a >= 1) return top
  const mix = (t: number, b: number) => toLinear(toGamma(t) * top.a + toGamma(b) * (1 - top.a))
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 }
}

export const luminance = (c: Rgba) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

export function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

export function toHex(c: Rgba): string {
  return `#${[c.r, c.g, c.b]
    .map((v) =>
      Math.round(toGamma(v) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}
