import type { OpeningHours } from '@/api/schemas'

import { closureLabel, copyToAll, draftFromApi, endsNextDay, requestFromDraft } from './hours'

const api = (days: OpeningHours['days']): OpeningHours => ({
  timezone: 'Africa/Porto-Novo',
  isOpenNow: true,
  nextOpening: null,
  days,
  closures: [],
})

describe('horaires en édition', () => {
  it('lit la semaine : jour absent = fermé, 7 jours 24 h/24 = toute la semaine', () => {
    const d = draftFromApi(api([{ weekday: 1, is24h: false, ranges: [{ opens: '06:00', closes: '22:00' }] }]))
    expect(d.allWeek24h).toBe(false)
    expect(d.days[0]).toMatchObject({ open: true, ranges: [{ opens: '06:00', closes: '22:00' }] })
    expect(d.days[6]).toMatchObject({ weekday: 7, open: false })
    const all = draftFromApi(api(Array.from({ length: 7 }, (_, i) => ({ weekday: i + 1, is24h: true, ranges: [] }))))
    expect(all.allWeek24h).toBe(true)
  })

  it('n’envoie que les jours ouverts, sans plage pour un jour 24 h/24', () => {
    const d = draftFromApi(api([]))
    d.days[0] = {
      weekday: 1,
      open: true,
      is24h: false,
      ranges: [
        { opens: '06:00', closes: '12:00' },
        { opens: '15:00', closes: '22:00' },
      ],
    }
    d.days[1] = { weekday: 2, open: true, is24h: true, ranges: [{ opens: '06:00', closes: '22:00' }] }
    expect(requestFromDraft(d)).toEqual({
      days: [
        {
          weekday: 1,
          is24h: false,
          ranges: [
            { opens: '06:00', closes: '12:00' },
            { opens: '15:00', closes: '22:00' },
          ],
        },
        { weekday: 2, is24h: true, ranges: [] },
      ],
    })
    expect(requestFromDraft({ ...d, allWeek24h: true })).toEqual({ allWeek24h: true, days: [] })
  })

  it('copie un jour sur toute la semaine, chaque jour gardant son numéro', () => {
    const d = draftFromApi(api([{ weekday: 3, is24h: false, ranges: [{ opens: '07:00', closes: '21:00' }] }]))
    const copied = copyToAll(d.days, 3)
    expect(copied.map((x) => x.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(copied.every((x) => x.open && x.ranges[0]?.opens === '07:00')).toBe(true)
    // Copie profonde : modifier un jour ne touche pas les autres.
    copied[0]!.ranges[0]!.opens = '05:00'
    expect(copied[1]!.ranges[0]!.opens).toBe('07:00')
  })

  it('repère une fermeture le lendemain et lit une date de fermeture', () => {
    expect(endsNextDay({ opens: '18:00', closes: '02:00' })).toBe(true)
    expect(endsNextDay({ opens: '06:00', closes: '00:00' })).toBe(true)
    expect(endsNextDay({ opens: '06:00', closes: '22:00' })).toBe(false)
    expect(closureLabel('2026-12-25')).toBe('vendredi 25 décembre')
  })
})
