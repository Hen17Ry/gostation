import { formatAgo, formatDistance, formatDuration, formatQuantity, formatReopening, spokenDistance } from './format'

// Espaces insécables (fines ou non) des formats fr-FR : normalisées pour les comparaisons.
const n = (s: string) => s.replace(/[  ]/g, ' ')

describe('formats', () => {
  it('distances', () => {
    expect(n(formatDistance(447))).toBe('450 m')
    expect(n(formatDistance(1234))).toBe('1,2 km')
    expect(n(formatDistance(25_400))).toBe('25 km')
  })

  // Régression : « la plus proche à ≈ 320 » puis « m » seul à la ligne suivante.
  it('ne sépare jamais un nombre de son unité', () => {
    for (const s of [
      formatDistance(447),
      formatDistance(1234),
      formatDuration(65 * 60),
      formatQuantity('liter', 1200),
    ]) {
      expect(s).not.toMatch(/ /)
    }
  })

  it('durées', () => {
    expect(n(formatDuration(20))).toBe('1 min')
    expect(n(formatDuration(7 * 60))).toBe('7 min')
    expect(n(formatDuration(65 * 60))).toBe('1 h 05')
  })

  it('quantités', () => {
    expect(n(formatQuantity('cylinder', 1))).toBe('1 bouteille')
    expect(n(formatQuantity('cylinder', 12))).toBe('12 bouteilles')
    expect(n(formatQuantity('liter', 1200))).toBe('1 200 L')
  })

  it('« il y a »', () => {
    expect(formatAgo(30)).toBe('à l’instant')
    expect(n(formatAgo(5 * 60))).toBe('il y a 5 min')
    expect(n(formatAgo(3 * 3600 + 10))).toBe('il y a 3 h')
    expect(n(formatAgo(3 * 86_400))).toBe('il y a 3 j')
  })

  it('distances lues par la synthèse vocale', () => {
    expect(spokenDistance(187)).toBe('200 mètres')
    expect(spokenDistance(42)).toBe('40 mètres')
    expect(spokenDistance(1000)).toBe('1 kilomètre')
    expect(spokenDistance(2460)).toBe('2,5 kilomètres')
  })
})

describe('formatReopening (heure du Bénin, UTC+1)', () => {
  // 2026-10-12 à 20:00 au Bénin = 19:00 UTC.
  const now = new Date('2026-10-12T19:00:00Z')

  it('aujourd’hui : « à HH:MM »', () => {
    expect(formatReopening('2026-10-12T21:30:00Z', now)).toBe('à 22:30')
  })

  it('demain : « demain à 06:00 »', () => {
    expect(formatReopening('2026-10-13T05:00:00Z', now)).toBe('demain à 06:00')
  })

  it('plus tard : le jour de la semaine', () => {
    expect(formatReopening('2026-10-15T05:00:00Z', now)).toBe('jeudi à 06:00')
  })

  it('minuit passé au Bénin compte pour le lendemain', () => {
    // 23:30 UTC = 00:30 le 13 au Bénin.
    expect(formatReopening('2026-10-12T23:30:00Z', now)).toBe('demain à 00:30')
  })
})
