import AxeBuilder from '@axe-core/playwright'

import { expect, test } from './fixtures'

/** Adresses fixes des textes légaux : Google OAuth et Google Play pointent dessus. */
const PAGES = [
  ['/politique-confidentialite', /Politique de confidentialité/],
  ['/cgu', /Conditions d'utilisation/],
  ['/suppression-compte', /Supprimer votre compte/],
] as const

for (const [path, title] of PAGES) {
  test(`${path} (et ${path}.html) : le texte légal, lisible et accessible`, async ({ page, watch }) => {
    void watch
    for (const url of [path, `${path}.html`]) {
      const res = await page.goto(url)
      expect(res?.status()).toBe(200)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
    }
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations.map((v) => v.id)).toEqual([])
  })
}

test('pied de page : liens vers les textes légaux et le contact', async ({ page, watch }) => {
  void watch
  await page.goto('/?mode=reduced')
  const footer = page.locator('footer')
  await expect(footer.getByRole('link', { name: 'Politique de confidentialité' })).toHaveAttribute(
    'href',
    '/politique-confidentialite',
  )
  await expect(footer.getByRole('link', { name: 'Conditions d’utilisation' })).toHaveAttribute('href', '/cgu')
  await expect(footer.getByRole('link', { name: 'Suppression de compte' })).toHaveAttribute(
    'href',
    '/suppression-compte',
  )
  await expect(footer.getByRole('link', { name: /contact@/ })).toHaveAttribute('href', /^mailto:contact@/)
})

test('adresse inconnue : page 404 du site', async ({ page }) => {
  const res = await page.goto('/nulle-part')
  expect(res?.status()).toBe(404)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Cette page n’existe pas.')
})
