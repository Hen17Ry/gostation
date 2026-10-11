import { locale } from '@/i18n'

/** Fuseau des stats (ARCHITECTURE D34) ; l'API le rappelle dans `period.timezone`. */
export const DEFAULT_TIMEZONE = 'Africa/Porto-Novo'

// Formateurs créés au premier usage : instancier Intl charge les données ICU (plusieurs dizaines
// de ms), inutile pour l'écran de connexion.
const cache = new Map<string, Intl.NumberFormat>()
function nf(key: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
  let f = cache.get(key)
  if (!f) cache.set(key, (f = new Intl.NumberFormat(locale, options)))
  return f
}
const integer = () => nf('integer', { maximumFractionDigits: 0 })
const compact = () => nf('compact', { notation: 'compact', maximumFractionDigits: 1 })

export const formatInteger = (n: number) => integer().format(n)
/** Graduation d'axe : compacte dès 1 000 (« 4,5 k », « 18 k »), pour des ticks homogènes. */
export const formatAxis = (n: number) => (Math.abs(n) < 1000 ? integer() : compact()).format(n)
/** 0.256 → « 26 % » ; sous 10 %, une décimale (« 4,2 % »). */
export const formatPercent = (ratio: number) =>
  nf(Math.abs(ratio) < 0.1 && ratio !== 0 ? 'percent1' : 'percent0', {
    style: 'percent',
    maximumFractionDigits: Math.abs(ratio) < 0.1 && ratio !== 0 ? 1 : 0,
  }).format(ratio)

/** Durée lisible depuis des secondes : « 3 j », « 5 h », « 12 min ». */
export function formatDuration(seconds: number): string {
  const min = Math.round(seconds / 60)
  if (min < 60) return `${Math.max(1, min)} min`
  const h = Math.round(min / 60)
  if (h < 48) return `${h} h`
  return `${Math.round(h / 24)} j`
}

const dateCache = new Map<string, Intl.DateTimeFormat>()
/** Formateurs de dates mis en cache : en créer un par libellé coûte cher (axes, tableaux). */
function dateFormat(options: Intl.DateTimeFormatOptions, timeZone = DEFAULT_TIMEZONE) {
  const key = `${timeZone}|${JSON.stringify(options)}`
  let f = dateCache.get(key)
  if (!f) dateCache.set(key, (f = new Intl.DateTimeFormat(locale, { timeZone, ...options })))
  return f
}

/** Libellé d'une tranche de série : « 14 h » (heure) ou « lun. 6 » (jour). */
export function formatBucket(iso: string, granularity: 'hour' | 'day', timeZone?: string): string {
  const d = new Date(iso)
  return granularity === 'hour'
    ? dateFormat({ hour: '2-digit', minute: '2-digit' }, timeZone).format(d)
    : dateFormat({ weekday: 'short', day: 'numeric' }, timeZone).format(d)
}

/** Libellé long (infobulle, tableau) : « lundi 6 octobre, 14:00 » ou « lundi 6 octobre ». */
export function formatBucketLong(iso: string, granularity: 'hour' | 'day', timeZone?: string): string {
  const d = new Date(iso)
  return granularity === 'hour'
    ? dateFormat(
        { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' },
        timeZone,
      ).format(d)
    : dateFormat({ weekday: 'long', day: 'numeric', month: 'long' }, timeZone).format(d)
}

/** « du 5 au 11 oct. 2026 » à partir de bornes [from, to[ (to exclu). */
export function formatRange(fromIso: string, toIso: string, timeZone?: string): string {
  const from = new Date(fromIso)
  const toInclusive = new Date(new Date(toIso).getTime() - 1)
  const fmt = dateFormat({ day: 'numeric', month: 'short', year: 'numeric' }, timeZone)
  return fmt.formatRange(from, toInclusive)
}

/** Date locale AAAA-MM-JJ d'un instant, dans le fuseau des stats. */
export function toLocalDate(d: Date, timeZone = DEFAULT_TIMEZONE): string {
  const key = `iso|${timeZone}`
  let f = dateCache.get(key)
  if (!f)
    dateCache.set(
      key,
      (f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })),
    )
  return f.format(d)
}

/** Coordonnées lisibles : « 6,37° N · 2,43° E ». */
export function formatLatLng(lat: number, lng: number): string {
  const f = nf('coord', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${f.format(Math.abs(lat))}° ${lat >= 0 ? 'N' : 'S'} · ${f.format(Math.abs(lng))}° ${lng >= 0 ? 'E' : 'O'}`
}

/** Compte à rebours mm:ss. */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
