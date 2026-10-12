import { Moon, Sun } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'

import { Button } from '@/components/ui/button'
import { t } from '@/i18n'
import { useTheme } from '@/lib/theme'

import { themeOptions } from './theme-options'

// Le menu (Radix DropdownMenu et son positionnement) n'est pas nécessaire au premier affichage :
// il est préchargé au survol ou au focus du bouton, et ouvert au clic.
const loadMenu = () => import('./theme-menu')
const ThemeMenu = lazy(loadMenu)

export function ThemeToggle() {
  const { preference, resolved } = useTheme()
  const [open, setOpen] = useState(false)
  const Current = resolved === 'dark' ? Moon : Sun
  const trigger = (
    <Button
      variant="ghost"
      size="icon"
      aria-haspopup="menu"
      aria-label={`${t.topbar.theme} : ${themeOptions.find((o) => o.value === preference)?.label}`}
      onPointerEnter={() => void loadMenu()}
      onFocus={() => void loadMenu()}
      onClick={() => setOpen(true)}
    >
      <Current aria-hidden />
    </Button>
  )
  if (!open) return trigger
  return (
    <Suspense fallback={trigger}>
      <ThemeMenu defaultOpen />
    </Suspense>
  )
}
