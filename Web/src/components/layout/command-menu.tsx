import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { CalendarRange, Fuel, Loader2, LogOut, User } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'

import { stationsQuery, usersQuery } from '@/api/admin'
import { StationStatusBadge } from '@/components/status/badges'
import { ta } from '@/i18n/admin'

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import type { PeriodKey } from '@/features/dashboard/period'
import { t } from '@/i18n'
import { setThemePreference } from '@/lib/theme'
import { cn } from '@/lib/utils'
import { useSignOut } from '@/features/auth/use-sign-out'

import { navItems } from './nav'
import { themeOptions } from './theme-options'

/** Saisie envoyée à l'API 250 ms après la dernière frappe, à partir de 2 caractères. */
function useDebounced(value: string, ms = 250): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return debounced
}

/**
 * Palette ⌘K : navigation, recherche de stations (nom, IFU) et de comptes (nom, email), période du
 * tableau de bord, thème, déconnexion. Chargée à la demande.
 */
export default function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const { signOut } = useSignOut()
  const [input, setInput] = useState('')
  const term = useDebounced(input.trim())
  const searching = term.length >= 2
  const stations = useQuery({ ...stationsQuery({ status: 'all', q: term, limit: 5 }), enabled: open && searching })
  const users = useQuery({ ...usersQuery({ q: term }), enabled: open && searching, select: (d) => d.items.slice(0, 5) })
  const pending = searching && (stations.isFetching || users.isFetching)

  function run(action: () => void) {
    onOpenChange(false)
    action()
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setInput('')
        onOpenChange(o)
      }}
      title={t.command.title}
      description={t.command.description}
    >
      <CommandInput placeholder={ta.command.placeholder} value={input} onValueChange={setInput} />
      <CommandList>
        <CommandEmpty>{pending ? ta.command.searching : t.command.empty}</CommandEmpty>
        {searching && (stations.data?.items.length ?? 0) > 0 && (
          <CommandGroup heading={ta.command.stations}>
            {stations.data!.items.map((st) => (
              <Item
                key={st.id}
                keywords={[input, st.ifu]}
                value={`station ${st.id} ${st.name}`}
                onSelect={() => run(() => void navigate({ to: '/stations/$stationId', params: { stationId: st.id } }))}
              >
                <Fuel aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{st.name}</span>
                  <span className="truncate font-mono text-2xs text-muted-foreground">IFU {st.ifu}</span>
                </span>
                <StationStatusBadge status={st.status} />
              </Item>
            ))}
          </CommandGroup>
        )}
        {searching && (users.data?.length ?? 0) > 0 && (
          <CommandGroup heading={ta.command.users}>
            {users.data!.map((u) => (
              <Item
                key={u.id}
                keywords={[input, u.email]}
                value={`user ${u.id} ${u.firstName} ${u.lastName}`}
                onSelect={() => run(() => void navigate({ to: '/users', search: { user: u.id, q: u.email } }))}
              >
                <User aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">
                    {u.firstName} {u.lastName}
                  </span>
                  <span className="truncate text-2xs text-muted-foreground">{u.email}</span>
                </span>
                <CommandShortcut>{ta.users.roles[u.role]}</CommandShortcut>
              </Item>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading={t.command.navigate}>
          {navItems.map(({ to, label, icon: Icon }) => (
            <Item key={to} onSelect={() => run(() => void navigate({ to }))} keywords={[to]}>
              <Icon aria-hidden />
              {label}
            </Item>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t.command.period}>
          {(['24h', '7d', '30d'] as PeriodKey[]).map((p) => (
            <Item key={p} onSelect={() => run(() => void navigate({ to: '/', search: { period: p } }))}>
              <CalendarRange aria-hidden />
              {t.dashboard.periodLong[p]}
              <CommandShortcut>{t.dashboard.periods[p]}</CommandShortcut>
            </Item>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t.command.preferences}>
          {themeOptions.map(({ value, label, icon: Icon }) => (
            <Item
              key={value}
              onSelect={() => run(() => setThemePreference(value))}
              keywords={['thème', 'theme', 'mode']}
            >
              <Icon aria-hidden />
              {t.command.themeTo(label)}
            </Item>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading={t.command.session}>
          <Item onSelect={() => run(() => void signOut())} keywords={['logout', 'déconnexion']}>
            <LogOut aria-hidden />
            {t.topbar.signOut}
          </Item>
        </CommandGroup>
      </CommandList>
      {/* Hors de la liste (une listbox ne contient que des options et des groupes) ; région toujours
          présente pour que les lecteurs d'écran annoncent le début de la recherche. */}
      <div
        role="status"
        className={cn(
          'flex items-center gap-2 border-t px-3 py-2 text-xs text-muted-foreground',
          !pending && 'sr-only',
        )}
      >
        {pending && (
          <>
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            {ta.command.searching}
          </>
        )}
      </div>
    </CommandDialog>
  )
}

function Item({
  children,
  onSelect,
  keywords,
  value,
}: {
  children: ReactNode
  onSelect: () => void
  keywords?: string[]
  value?: string
}) {
  return (
    <CommandItem onSelect={onSelect} keywords={keywords} value={value}>
      {children}
    </CommandItem>
  )
}
