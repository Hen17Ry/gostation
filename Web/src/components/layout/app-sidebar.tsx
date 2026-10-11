import { Link, useRouterState } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { Logo } from '@/components/brand/logo'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t } from '@/i18n'

import { type NavItem, navSections } from './nav'
import { SIDEBAR_RAIL, SIDEBAR_WIDTH } from './sidebar-state'
import { useNavBadges } from './use-nav-badges'

/*
 * Barre latérale, adaptée du composant « Sidebar » de 21st.dev (wensity) : sections titrées,
 * badges, pastille active qui glisse d'un lien à l'autre, pied avec l'identité. Différence
 * majeure : le repli n'anime jamais la largeur. Le panneau (largeur fixe) glisse vers la gauche
 * et son contenu glisse d'autant vers la droite : seule la colonne d'icônes reste visible. Les
 * deux mouvements sont des transform, sur le compositeur (60 fps) ; le contenu principal suit
 * en FLIP (app-shell.tsx).
 */

const SHIFT = SIDEBAR_WIDTH - SIDEBAR_RAIL

export function AppSidebar({ collapsed, id }: { collapsed: boolean; id: string }) {
  return (
    <aside
      id={id}
      data-collapsed={collapsed}
      className="fixed inset-y-0 left-0 z-30 hidden overflow-hidden border-r border-sidebar-border bg-sidebar transition-transform duration-240 ease-(--ease-out) will-change-transform md:block"
      style={{ width: SIDEBAR_WIDTH, transform: collapsed ? `translateX(-${SHIFT}px)` : undefined }}
    >
      <div
        className="h-full transition-transform duration-240 ease-(--ease-out) will-change-transform"
        style={{ width: SIDEBAR_WIDTH, transform: collapsed ? `translateX(${SHIFT}px)` : undefined }}
      >
        <SidebarContent collapsed={collapsed} />
      </div>
    </aside>
  )
}

/** Contenu de la barre : partagé par la barre fixe (≥ 768 px) et le tiroir mobile. */
export function SidebarContent({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const badges = useNavBadges()
  const navRef = useRef<HTMLDivElement>(null)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [pill, setPill] = useState<{ y: number; h: number } | null>(null)

  // Pastille active : mesurée sur le lien actif, déplacée en translateY.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const el = navRef.current?.querySelector<HTMLElement>('[data-nav-item][data-status="active"]')
      setPill(el ? { y: el.offsetTop, h: el.offsetHeight } : null)
    })
    return () => cancelAnimationFrame(id)
  }, [pathname])

  return (
    <div data-collapsed={collapsed} className="group/sidebar flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center px-3.5">
        <Link
          to="/"
          onClick={onNavigate}
          className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Logo textClassName="transition-opacity duration-(--duration-base) group-data-[collapsed=true]/sidebar:opacity-0" />
        </Link>
      </div>

      <nav
        aria-label={t.nav.label}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain py-2"
      >
        <div ref={navRef} className="relative">
          {pill && (
            <>
              <span
                aria-hidden
                className="pointer-events-none absolute top-0 right-2 left-2 rounded-md bg-sidebar-active transition-[transform,opacity] duration-240 ease-(--ease-out) group-data-[collapsed=true]/sidebar:opacity-0"
                style={{ height: pill.h, transform: `translateY(${pill.y}px)` }}
              />
              <span
                aria-hidden
                className="pointer-events-none absolute top-0 left-2 w-11 rounded-md bg-sidebar-active opacity-0 transition-[transform,opacity] duration-240 ease-(--ease-out) group-data-[collapsed=true]/sidebar:opacity-100"
                style={{ height: pill.h, transform: `translateY(${pill.y}px)` }}
              />
            </>
          )}
          {navSections.map((section) => (
            <div key={section.label} role="group" aria-label={section.label} className="pb-3">
              <div className="relative flex h-7 items-end px-[22px] pb-1.5">
                <span className="text-2xs font-medium tracking-wider text-muted-foreground uppercase transition-opacity duration-(--duration-base) group-data-[collapsed=true]/sidebar:opacity-0">
                  {section.label}
                </span>
                <span
                  aria-hidden
                  className="absolute bottom-3 left-[18px] h-px w-6 bg-sidebar-border opacity-0 transition-opacity duration-(--duration-base) group-data-[collapsed=true]/sidebar:opacity-100"
                />
              </div>
              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => (
                  <li key={item.to}>
                    <SidebarLink
                      item={item}
                      collapsed={collapsed}
                      count={item.badge ? badges[item.badge] : undefined}
                      onNavigate={onNavigate}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </div>
  )
}

function SidebarLink({
  item,
  collapsed,
  count,
  onNavigate,
}: {
  item: NavItem
  collapsed: boolean
  count?: number
  onNavigate?: () => void
}) {
  const [tip, setTip] = useState(false)
  const Icon = item.icon
  const hasCount = count !== undefined && count > 0
  return (
    <Tooltip open={collapsed && tip} onOpenChange={setTip}>
      <TooltipTrigger asChild>
        <Link
          to={item.to}
          activeOptions={{ exact: item.exact ?? false }}
          onClick={onNavigate}
          data-nav-item
          className="group/item relative mx-2 flex h-9 items-center gap-3 rounded-md px-3 text-sm text-sidebar-foreground outline-none data-[status=active]:font-medium data-[status=active]:text-foreground"
        >
          {/* Survol et focus : même forme que la pastille (pleine largeur, ou carré en rail). */}
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-full rounded-md transition-colors duration-(--duration-fast) group-hover/item:bg-sidebar-active/70 group-focus-visible/item:ring-2 group-focus-visible/item:ring-ring group-data-[collapsed=true]/sidebar:w-11 group-data-[status=active]/item:group-hover/item:bg-transparent"
          />
          <Icon
            aria-hidden
            className="relative size-[18px] shrink-0 text-muted-foreground transition-colors group-hover/item:text-foreground group-data-[status=active]/item:text-brand-text"
          />
          <span className="relative truncate transition-opacity duration-(--duration-base) group-data-[collapsed=true]/sidebar:opacity-0">
            {item.label}
          </span>
          {hasCount && (
            <>
              <span className="sr-only">, {count} à traiter</span>
              <span
                aria-hidden
                className="relative ml-auto rounded-full bg-primary-subtle px-1.5 py-px text-2xs font-medium text-primary-subtle-foreground tabular-nums transition-opacity duration-(--duration-base) group-data-[collapsed=true]/sidebar:opacity-0"
              >
                {count > 99 ? '99+' : count}
              </span>
              <span
                aria-hidden
                className="absolute top-1.5 left-[30px] size-2 rounded-full bg-primary opacity-0 ring-2 ring-sidebar transition-opacity duration-(--duration-base) group-data-[collapsed=true]/sidebar:opacity-100"
              />
            </>
          )}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {item.label}
        {hasCount && <span className="ml-1.5 tabular-nums opacity-70">{count}</span>}
      </TooltipContent>
    </Tooltip>
  )
}
