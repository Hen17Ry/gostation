import { Link, useMatches } from '@tanstack/react-router'
import { Fragment, useEffect } from 'react'

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { t } from '@/i18n'
import { pageTitle } from '@/lib/app-env'

/** Fil d'Ariane depuis les `staticData.title` des routes ; met aussi à jour le titre de l'onglet. */
export function Breadcrumbs() {
  const crumbs = useMatches({
    select: (matches) =>
      matches.filter((m) => m.staticData.title).map((m) => ({ id: m.id, title: m.staticData.title!, to: m.pathname })),
  })
  const current = crumbs.at(-1)?.title

  useEffect(() => {
    document.title = pageTitle(current ? `${current} · ${t.app.name}` : `${t.app.name} · ${t.app.product}`)
  }, [current])

  return (
    <Breadcrumb aria-label={t.nav.breadcrumb} className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        <BreadcrumbItem className="hidden sm:inline-flex">
          <BreadcrumbLink asChild>
            <Link to="/">{t.app.name}</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {crumbs.map((c, i) => (
          <Fragment key={c.id}>
            <BreadcrumbSeparator className="hidden sm:inline-flex" />
            <BreadcrumbItem className="min-w-0">
              {i === crumbs.length - 1 ? (
                <BreadcrumbPage className="truncate font-medium">{c.title}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link to={c.to}>{c.title}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
