import { LogOut, ShieldCheck } from 'lucide-react'

import type { Profile } from '@/api/schemas'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSignOut } from '@/features/auth/use-sign-out'
import { t } from '@/i18n'
import { initials } from '@/lib/initials'

export function UserMenu({ me }: { me?: Profile }) {
  const { signOut, pending } = useSignOut()
  // Profil en cours de vérification (coquille affichée sans attendre /me) : pastille neutre.
  if (!me)
    return (
      <Button variant="ghost" size="icon" className="rounded-full" disabled aria-label={t.topbar.account}>
        <Skeleton aria-hidden className="size-8 rounded-full" />
      </Button>
    )
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label={`${initials(me)}, ${t.topbar.account}`}
        >
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-full bg-primary-subtle text-xs font-semibold text-primary-subtle-foreground ring-1 ring-primary/25"
          >
            {initials(me)}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal">
          <span className="truncate text-sm font-medium">
            {me.firstName} {me.lastName}
          </span>
          <span className="truncate text-xs text-muted-foreground">{me.email}</span>
          <span className="mt-1.5 inline-flex items-center gap-1 text-2xs text-success-subtle-foreground">
            <ShieldCheck className="size-3.5" aria-hidden />
            {t.topbar.adminRole}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={pending} onSelect={() => void signOut()}>
          <LogOut aria-hidden />
          {pending ? t.topbar.signingOut : t.topbar.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
