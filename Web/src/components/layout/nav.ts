import type { LinkProps } from '@tanstack/react-router'
import {
  BellRing,
  FileDown,
  Flag,
  Fuel,
  LayoutDashboard,
  type LucideIcon,
  Map,
  Package,
  ScrollText,
  Users,
} from 'lucide-react'

import { t } from '@/i18n'

export type NavBadge = 'pending' | 'reports' | 'alerts'

export interface NavItem {
  to: LinkProps['to'] & string
  label: string
  icon: LucideIcon
  exact?: boolean
  badge?: NavBadge
}

export interface NavSection {
  label: string
  items: NavItem[]
}

/** Sections de l'admin, dans l'ordre du back-office (CLAUDE.md, rôle admin). */
export const navSections: NavSection[] = [
  { label: t.nav.overview, items: [{ to: '/', label: t.nav.dashboard, icon: LayoutDashboard, exact: true }] },
  {
    label: t.nav.operations,
    items: [
      { to: '/stations', label: t.nav.stations, icon: Fuel, badge: 'pending' },
      { to: '/maps', label: t.nav.maps, icon: Map },
      { to: '/reports', label: t.nav.reports, icon: Flag, badge: 'reports' },
      { to: '/alerts', label: t.nav.alerts, icon: BellRing, badge: 'alerts' },
      { to: '/users', label: t.nav.users, icon: Users },
    ],
  },
  {
    label: t.nav.platform,
    items: [
      { to: '/catalog', label: t.nav.catalog, icon: Package },
      { to: '/audit', label: t.nav.audit, icon: ScrollText },
      { to: '/exports', label: t.nav.exports, icon: FileDown },
    ],
  },
]

export const navItems = navSections.flatMap((s) => s.items)
