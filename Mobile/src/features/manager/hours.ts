import type { components } from '@/api/schema'
import type { OpeningHours } from '@/api/schemas'

/**
 * Horaires en édition (D12, D64) : 7 jours (1 = lundi), fermé ou ouvert, 24 h/24 ou jusqu'à 2
 * plages ; ou 24 h/24 toute la semaine. Conversion depuis et vers l'API (jour absent = fermé).
 */
export interface TimeRange {
  opens: string
  closes: string
}
export interface DayDraft {
  weekday: number
  open: boolean
  is24h: boolean
  ranges: TimeRange[]
}
export interface HoursDraft {
  allWeek24h: boolean
  days: DayDraft[]
}

export const MAX_RANGES = 2
export const DEFAULT_RANGE: TimeRange = { opens: '06:00', closes: '22:00' }
/** Seconde plage proposée : l'après-midi après la première. */
export const SECOND_RANGE: TimeRange = { opens: '15:00', closes: '22:00' }

export function draftFromApi(h: OpeningHours): HoursDraft {
  const byDay = new Map(h.days.map((d) => [d.weekday, d]))
  const days = Array.from({ length: 7 }, (_, i): DayDraft => {
    const d = byDay.get(i + 1)
    if (!d) return { weekday: i + 1, open: false, is24h: false, ranges: [DEFAULT_RANGE] }
    return {
      weekday: i + 1,
      open: true,
      is24h: d.is24h,
      ranges:
        d.is24h || d.ranges.length === 0
          ? [DEFAULT_RANGE]
          : d.ranges.map((r) => ({ opens: r.opens, closes: r.closes })),
    }
  })
  return { allWeek24h: days.every((d) => d.open && d.is24h), days }
}

export function requestFromDraft(d: HoursDraft): components['schemas']['ReplaceHoursRequest'] {
  if (d.allWeek24h) return { allWeek24h: true, days: [] }
  return {
    days: d.days
      .filter((day) => day.open)
      .map((day) => ({
        weekday: day.weekday,
        is24h: day.is24h,
        ranges: day.is24h ? [] : day.ranges.slice(0, MAX_RANGES),
      })),
  }
}

/** « Copier sur tous les jours » : la configuration d'un jour appliquée à la semaine. */
export function copyToAll(days: DayDraft[], weekday: number): DayDraft[] {
  const src = days.find((d) => d.weekday === weekday)
  if (!src) return days
  return days.map((d) => ({ ...src, weekday: d.weekday, ranges: src.ranges.map((r) => ({ ...r })) }))
}

/** Plage qui finit le lendemain (fermeture antérieure ou égale à l'ouverture, minuit compris). */
export const endsNextDay = (r: TimeRange) => r.closes === '00:00' || r.closes === '24:00' || r.closes <= r.opens

/** Date d'une fermeture, lisible : « mardi 14 octobre ». */
export const closureLabel = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`),
  )

/** Aujourd'hui au Bénin (AAAA-MM-JJ). */
export const todayInBenin = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Porto-Novo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
