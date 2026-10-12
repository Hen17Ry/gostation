import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react-native'
import { type ReactElement } from 'react'

import { ThemeProvider } from '@/theme/theme'

/** Rendu de test avec thème et client de requêtes isolé (sans nouvel essai). */
export async function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  })
  const wrap = (node: ReactElement) => (
    <QueryClientProvider client={client}>
      <ThemeProvider>{node}</ThemeProvider>
    </QueryClientProvider>
  )
  const result = await render(wrap(ui))
  return { ...result, rerender: (node: ReactElement) => result.rerender(wrap(node)) }
}
