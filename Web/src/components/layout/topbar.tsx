import { Menu, PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react'

import type { Profile } from '@/api/schemas'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { t } from '@/i18n'
import { isMac, modKey } from '@/lib/platform'

import { Breadcrumbs } from './breadcrumbs'
import { EnvBadge } from './env-badge'
import { ThemeToggle } from './theme-toggle'
import { UserMenu } from './user-menu'

export function Topbar({
  me,
  collapsed,
  sidebarId,
  onToggleSidebar,
  onOpenMobileNav,
  onOpenCommand,
}: {
  me?: Profile
  collapsed: boolean
  sidebarId: string
  onToggleSidebar: () => void
  onOpenMobileNav: () => void
  onOpenCommand: () => void
}) {
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose
  const toggleLabel = collapsed ? t.nav.expand : t.nav.collapse
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 supports-backdrop-filter:bg-background/80 supports-backdrop-filter:backdrop-blur-sm md:px-4">
      <Button variant="ghost" size="icon" className="md:hidden" aria-label={t.nav.openMenu} onClick={onOpenMobileNav}>
        <Menu aria-hidden />
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="hidden text-muted-foreground md:inline-flex"
            aria-label={toggleLabel}
            aria-expanded={!collapsed}
            aria-controls={sidebarId}
            onClick={onToggleSidebar}
          >
            <ToggleIcon aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {toggleLabel} <kbd className="ml-1 font-sans opacity-70">{modKey} B</kbd>
        </TooltipContent>
      </Tooltip>
      <span aria-hidden className="mr-1 hidden h-5 w-px bg-border md:block" />
      <Breadcrumbs />
      <EnvBadge className="ml-1" />
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="outline"
          className="h-9 w-9 justify-start gap-2 px-0 text-muted-foreground shadow-none sm:w-56 sm:px-3 lg:w-72"
          onClick={onOpenCommand}
          aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
        >
          <Search aria-hidden className="mx-auto sm:mx-0" />
          <span className="sr-only sm:not-sr-only sm:flex-1 sm:text-left sm:font-normal">{t.topbar.search}</span>
          <kbd className="pointer-events-none hidden h-5 items-center gap-0.5 rounded border bg-muted px-1.5 font-sans text-2xs font-medium sm:inline-flex">
            {modKey} K
          </kbd>
        </Button>
        <ThemeToggle />
        <UserMenu me={me} />
      </div>
    </header>
  )
}
