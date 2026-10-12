import { createFileRoute } from '@tanstack/react-router'

import { productsQuery } from '@/api/admin'
import { CatalogPage } from '@/features/catalog/catalog-page'
import { t } from '@/i18n'

export const Route = createFileRoute('/_app/catalog')({
  staticData: { title: t.nav.catalog },
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(productsQuery)
  },
  component: CatalogPage,
})
