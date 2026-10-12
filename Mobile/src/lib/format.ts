import { locale, t } from '@/i18n'

/** Fuseau du Bénin : horaires et « rouvre à » en heure locale de la station. */
export const TIMEZONE = 'Africa/Porto-Novo'

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>()
function nf(key: string, o: Intl.NumberFormatOptions) {
  let f = cache.get(key) as Intl.NumberFormat | undefined
  if (!f) cache.set(key, (f = new Intl.NumberFormat(locale, o)))
  return f
}
function df(key: string, o: Intl.DateTimeFormatOptions) {
  let f = cache.get(key) as Intl.DateTimeFormat | undefined
  if (!f) cache.set(key, (f = new Intl.DateTimeFormat(locale, { timeZone: TIMEZONE, ...o })))
  return f
}

export const formatInteger = (n: number) => nf('int', { maximumFractionDigits: 0 }).format(n)

/** « 450 m », « 1,2 km », « 25 km ». */
export function formatDistance(m: number): string {
  if (m < 1000) return `${formatInteger(Math.round(m / 10) * 10)} m`
  const km = m / 1000
  return `${nf(km < 10 ? 'km1' : 'km0', { maximumFractionDigits: km < 10 ? 1 : 0 }).format(km)} km`
}

/** « 7 min », « 1 h 05 ». */
export function formatDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60))
  if (min < 60) return `${min} min`
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`
}

/** « 06:00 » (heure locale du Bénin). */
export const formatTime = (iso: string | Date) =>
  df('time', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

const dayKey = (d: Date) => df('day', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

/**
 * « à 06:00 » aujourd'hui, « demain à 06:00 », sinon « lundi à 06:00 » (CLAUDE.md, règle mobile
 * « Station fermée »).
 */
export function formatReopening(iso: string, now = new Date()): string {
  const at = new Date(iso)
  const time = formatTime(at)
  if (dayKey(at) === dayKey(now)) return t.when.at(time)
  const tomorrow = new Date(now.getTime() + 86_400_000)
  if (dayKey(at) === dayKey(tomorrow)) return t.when.tomorrowAt(time)
  return t.when.dayAt(df('weekday', { weekday: 'long' }).format(at), time)
}

/**
 * « il y a 5 min », « il y a 3 h », « il y a 2 j » (Hermes n'a pas Intl.RelativeTimeFormat :
 * formulation française écrite ici).
 */
export function formatAgo(seconds: number): string {
  if (seconds < 60) return t.when.justNow
  if (seconds < 3600) return t.when.agoMin(Math.floor(seconds / 60))
  if (seconds < 172_800) return t.when.agoHour(Math.floor(seconds / 3600))
  return t.when.agoDay(Math.floor(seconds / 86_400))
}

export const agoFrom = (iso: string, now = Date.now()) => formatAgo(Math.max(0, (now - Date.parse(iso)) / 1000))

/** Quantité : « 12 bouteilles » ou « 1 200 L ». */
export const formatQuantity = (unit: 'cylinder' | 'liter', n: number) =>
  unit === 'cylinder' ? t.result.quantity.cylinder(n) : t.result.quantity.liter(formatInteger(n))

/** Distance lue par la synthèse vocale : « 200 mètres », « 1,5 kilomètre ». */
export function spokenDistance(m: number): string {
  if (m < 1000) {
    const r = m < 100 ? Math.max(10, Math.round(m / 10) * 10) : Math.round(m / 50) * 50
    return t.route.meters(r)
  }
  const km = Math.round(m / 100) / 10
  return t.route.kilometers(nf('km1', { maximumFractionDigits: 1 }).format(km), km)
}
