import { expect, test } from './fixtures'

/**
 * Bandeau défilant : jointure sans raccord entre deux jeux (correction du point de validation).
 * Horloge figée (page.clock) : la position du texte est déterministe, la capture de la jointure
 * est comparée à sa référence ; la géométrie (pas mesuré, copies contiguës, couverture) aussi.
 */
// Fenêtre large et basse : le texte (10,5 svh) est plus court que l'écran, une jointure est visible
// tout de suite (pas de longue avance de l'horloge, test stable en parallèle).
test.use({ viewport: { width: 2000, height: 600 } })

test('bandeau : copies contiguës, décalage d’un jeu exact, jointure nette', async ({ page, isMobile, watch }) => {
  void watch
  test.skip(isMobile, 'une fois suffit (même code)')
  await page.clock.install({ time: new Date('2026-10-23T08:00:00Z') })
  await page.goto('/?mode=lite')
  await page.evaluate(() => document.fonts.ready)
  // Horloge arrêtée : seul runFor la fait avancer, la position du texte ne dépend plus du temps réel.
  await page.clock.pauseAt(new Date('2026-10-23T08:00:05Z'))
  await page.clock.runFor(4000)
  await expect.poll(() => page.locator('[data-marquee-track]').getAttribute('data-loop')).not.toBeNull()

  const geometry = () =>
    page.evaluate(() => {
      const track = document.querySelector<HTMLElement>('[data-marquee-track]')!
      return {
        pitch: Number(track.dataset.loop),
        groups: [...track.children].map((g) => {
          const r = g.getBoundingClientRect()
          return { left: r.left, right: r.right }
        }),
        width: innerWidth,
      }
    })
  const g = await geometry()
  expect(g.groups.length).toBeGreaterThanOrEqual(2)
  for (let i = 1; i < g.groups.length; i++) {
    // Chaque jeu commence exactement où le précédent finit (séparateur final compris).
    expect(Math.abs(g.groups[i]!.left - g.groups[i - 1]!.right)).toBeLessThan(0.5)
    expect(Math.abs(g.groups[i]!.left - g.groups[i - 1]!.left - g.pitch)).toBeLessThan(0.5)
  }
  // Toujours de quoi couvrir l'écran, même au moment du bouclage (un pas de marge).
  expect(g.groups.at(-1)!.right - g.groups[0]!.left).toBeGreaterThanOrEqual(g.width + g.pitch - 1)

  // Fige la dérive : la jointure (début du jeu 2) est déjà à l'écran.
  await page.getByRole('button', { name: 'Mettre les animations en pause' }).click()
  await page.clock.runFor(1500)
  const at = (await geometry()).groups[1]!.left
  expect(at).toBeGreaterThan(260)
  expect(at).toBeLessThan(g.width - 260)
  const band = (await page.locator('[data-marquee-track]').boundingBox())!
  await expect(page).toHaveScreenshot('jointure-bandeau.png', {
    clip: { x: Math.round(at) - 260, y: Math.round(band.y), width: 520, height: Math.round(band.height) },
    // Lissage des glyphes au demi-pixel près : jusqu'à ~2 % de pixels peuvent varier d'un lancement
    // à l'autre. Un raccord défectueux (« GASOIKG ») en change bien davantage ; la géométrie, elle,
    // est vérifiée au demi-pixel ci-dessus.
    maxDiffPixelRatio: 0.05,
  })
})
