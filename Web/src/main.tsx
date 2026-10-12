import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './styles/globals.css'

import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { startThemeSync } from '@/lib/theme'

import { queryClient, router } from './router'

startThemeSync()

// La route d'arrivée (son chunk, sa garde) est résolue avant le premier rendu : celui-ci ne
// suspend pas, et React n'attend pas son délai de regroupement des Suspense pour peindre la page.
void router.load().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  )
})
