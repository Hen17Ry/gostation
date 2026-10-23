import { expect, test } from './fixtures'

test('menu mobile : s’ouvre, se ferme avec Échap, rend le focus', async ({ page, watch, isMobile }) => {
  void watch
  test.skip(!isMobile, 'menu réservé aux petits écrans')
  await page.goto('/?mode=reduced')
  const open = page.getByRole('button', { name: 'Ouvrir le menu' })
  await open.click()
  const dialog = page.getByRole('dialog', { name: 'Menu' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('link', { name: 'Gérants' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(open).toBeFocused()
})

test('lien d’évitement vers le contenu', async ({ page, watch }) => {
  void watch
  await page.goto('/?mode=reduced')
  await page.keyboard.press('Tab')
  const skip = page.getByRole('link', { name: 'Aller au contenu' })
  await expect(skip).toBeFocused()
  await expect(skip).toBeInViewport()
})
