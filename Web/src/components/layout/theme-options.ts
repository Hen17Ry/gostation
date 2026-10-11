import { Monitor, Moon, Sun } from 'lucide-react'

import { t } from '@/i18n'
import type { ThemePreference } from '@/lib/theme'

export const themeOptions: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: t.topbar.themeLight, icon: Sun },
  { value: 'dark', label: t.topbar.themeDark, icon: Moon },
  { value: 'system', label: t.topbar.themeSystem, icon: Monitor },
]
