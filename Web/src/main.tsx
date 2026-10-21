import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './styles/globals.css'

import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { reportError, startErrorTracking } from '@/lib/error-tracking'
import { startThemeSync } from '@/lib/theme'

import { queryClient, router } from './router'

startThemeSync()

// La route d'arrivée (son chunk, sa garde) est résolue avant le premier rendu : celui-ci ne
// suspend pas, et React n'attend pas son délai de regroupement des Suspense pour peindre la page.
void router.load().finally(() => {
  // Erreurs attrapées par un error boundary (écran) : envoyées au suivi des plantages, toujours
  // affichées en console comme par défaut. Les erreurs non attrapées passent par window.onerror.
  createRoot(document.getElementById('root')!, {
    onCaughtError: (error, info) => {
      reportError(error)
      console.error(error, info.componentStack)
    },
  }).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
  startErrorTracking()
})
