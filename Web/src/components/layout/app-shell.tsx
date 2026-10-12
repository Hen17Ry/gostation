import { lazy, type ReactNode, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Profile } from '@/api/schemas'
import { TooltipProvider } from '@/components/ui/tooltip'
import { t } from '@/i18n'

import { AppSidebar } from './app-sidebar'
import { MobileNav } from './mobile-nav'
import { SIDEBAR_RAIL, SIDEBAR_WIDTH, useSidebarCollapsed } from './sidebar-state'
import { Topbar } from './topbar'

// Palette ⌘K (cmdk) chargée au premier usage : hors du JS initial.
const CommandMenu = lazy(() => import('./command-menu'))

const SIDEBAR_ID = 'app-sidebar'
const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const isDesktop = () => window.matchMedia('(min-width: 768px)').matches

/** Coquille : barre latérale repliable, barre supérieure, contenu (`me` absent : profil en cours de vérification). */
export function AppShell({ me, children }: { me?: Profile; children: ReactNode }) {
  const { collapsed, toggle } = useSidebarCollapsed()
  const [mobileNav, setMobileNav] = useState(false)
  const [command, setCommand] = useState(false)
  const [commandLoaded, setCommandLoaded] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const previous = useRef(collapsed)

  const openCommand = useCallback(() => {
    setCommandLoaded(true)
    setCommand(true)
  }, [])

  // FLIP : le contenu prend sa nouvelle place d'un coup, puis glisse depuis l'ancienne en
  // transform. Une seule mise en page (graphiques compris), pas d'animation de largeur.
  useLayoutEffect(() => {
    if (previous.current === collapsed) return
    previous.current = collapsed
    const el = contentRef.current
    if (!el || !isDesktop() || reducedMotion()) return
    const delta = (collapsed ? 1 : -1) * (SIDEBAR_WIDTH - SIDEBAR_RAIL)
    el.animate([{ transform: `translateX(${delta}px)` }, { transform: 'translateX(0)' }], {
      duration: 240,
      easing: EASE_OUT,
    })
  }, [collapsed])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      const key = e.key.toLowerCase()
      if (key === 'k') {
        e.preventDefault()
        if (command) setCommand(false)
        else openCommand()
      } else if (key === 'b') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [command, openCommand, toggle])

  return (
    <TooltipProvider delayDuration={300}>
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t.app.skipToContent}
      </a>
      <AppSidebar collapsed={collapsed} id={SIDEBAR_ID} />
      <MobileNav open={mobileNav} onOpenChange={setMobileNav} />
      <div
        ref={contentRef}
        className="flex min-h-dvh flex-col md:pl-(--sidebar-current)"
        style={{ '--sidebar-current': `${collapsed ? SIDEBAR_RAIL : SIDEBAR_WIDTH}px` } as React.CSSProperties}
      >
        <Topbar
          me={me}
          collapsed={collapsed}
          sidebarId={SIDEBAR_ID}
          onToggleSidebar={toggle}
          onOpenMobileNav={() => setMobileNav(true)}
          onOpenCommand={openCommand}
        />
        <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
      {commandLoaded && (
        <Suspense fallback={null}>
          <CommandMenu open={command} onOpenChange={setCommand} />
        </Suspense>
      )}
    </TooltipProvider>
  )
}
