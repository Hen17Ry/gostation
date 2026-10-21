import '@testing-library/jest-dom/vitest'

import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

// Attentes (findBy*, waitFor) : 3 s au lieu d'1 s, voir testTimeout dans vite.config.ts.
configure({ asyncUtilTimeout: 3_000 })

afterEach(() => {
  cleanup()
  localStorage.clear()
})

// jsdom n'implémente pas matchMedia ni ResizeObserver (thème, graphiques, Radix).
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
// input-otp sonde la page (détection des gestionnaires de mots de passe) : absent de jsdom.
if (!document.elementFromPoint) {
  document.elementFromPoint = () => null
}

// sonner et input-otp injectent leur feuille de style à l'import. Tailwind n'étant pas chargé en
// test, ce sont les seules règles du document : jsdom les réévalue à chaque getComputedStyle, que
// user-event (focus, pointer-events) et les requêtes par rôle appellent à chaque action. Les
// retirer divise presque par deux le CPU des parcours d'interface (première connexion : 1,5 s →
// 0,9 s), qui dépassaient leurs 5 s quand Go, Web et Mobile tournaient ensemble. Les tests ne
// vérifient aucune de ces règles (positions et animations des toasts, sélection de l'OTP).
await import('sonner')
await import('input-otp')
document.head.querySelectorAll('style').forEach((style) => style.remove())
