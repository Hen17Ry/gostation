import { test as base, expect, type Page } from '@playwright/test'

/** Page qui relève les violations de CSP et les erreurs JavaScript : un test échoue sur l'une d'elles. */
export const test = base.extend<{ watch: { errors: string[] } }>({
  watch: async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`)
    })
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        console.error(`CSP: ${e.violatedDirective} ${e.blockedURI} ${e.sample}`)
      })
    })
    await use({ errors })
    expect(errors, errors.join('\n')).toEqual([])
  },
})

export { expect }

export const motionMode = (page: Page) => page.evaluate(() => document.documentElement.dataset.motion)
