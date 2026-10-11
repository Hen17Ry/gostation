import { useNavigate } from '@tanstack/react-router'
import { CalendarRange, LogOut } from 'lucide-react'
import type { ReactNode } from 'react'

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
import { useSignOut } from '@/features/auth/use-sign-out'

import { navItems } from './nav'
import { themeOptions } from './theme-options'

/** Palette ⌘K : navigation, période du tableau de bord, thème, déconnexion. Chargée à la demande. */
export default function CommandMenu({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const { signOut } = useSignOut()

  function run(action: () => void) {
    onOpenChange(false)
    action()
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title={t.command.title} description={t.command.description}>
      <CommandInput placeholder={t.command.placeholder} />
      <CommandList>
        <CommandEmpty>{t.command.empty}</CommandEmpty>
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
    </CommandDialog>
  )
}

function Item({ children, onSelect, keywords }: { children: ReactNode; onSelect: () => void; keywords?: string[] }) {
  return (
    <CommandItem onSelect={onSelect} keywords={keywords}>
      {children}
    </CommandItem>
  )
}
