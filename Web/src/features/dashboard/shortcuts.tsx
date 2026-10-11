import { Link } from '@tanstack/react-router'
import { ArrowUpRight, BellRing, Flag, Fuel, UserX } from 'lucide-react'
import type { ReactNode } from 'react'

import type { Dashboard } from '@/api/schemas'
import { t } from '@/i18n'
import { formatDuration, formatInteger } from '@/lib/format'
import { cn } from '@/lib/utils'

/** Raccourcis « À traiter » : dossiers en attente, signalements et alertes ouverts. */
export function Shortcuts({ data }: { data: Dashboard }) {
  const pending = data.stations.pendingApplications
  const kinds = Object.entries(data.alerts.byKind).filter(([, n]) => n > 0)
  return (
    <section aria-labelledby="todo-title" className="flex flex-col gap-3">
      <h2 id="todo-title" className="text-sm font-semibold">
        {t.dashboard.todo}
      </h2>
      <ul className="grid gap-3 @xl:grid-cols-2 @5xl:grid-cols-4">
        <Shortcut
          to="/stations"
          icon={<Fuel />}
          count={pending.count}
          label={t.dashboard.pending}
          hint={
            pending.oldestAgeS !== null && pending.count > 0
              ? t.dashboard.pendingOldest(formatDuration(pending.oldestAgeS))
              : t.dashboard.pendingNone
          }
          urgent={pending.count > 0}
        />
        <Shortcut
          to="/reports"
          icon={<Flag />}
          count={data.reports.open}
          label={t.dashboard.openReports}
          urgent={data.reports.open > 0}
        />
        <Shortcut
          to="/alerts"
          icon={<BellRing />}
          count={data.alerts.open}
          label={t.dashboard.openAlerts}
          hint={kinds.map(([k, n]) => `${n} ${t.dashboard.alertKinds[k] ?? k}`).join(' · ') || undefined}
          urgent={data.alerts.open > 0}
        />
        <Shortcut to="/alerts" icon={<UserX />} count={data.inactiveManagers} label={t.dashboard.inactiveManagers} />
      </ul>
    </section>
  )
}

function Shortcut({
  to,
  icon,
  count,
  label,
  hint,
  urgent = false,
}: {
  to: '/stations' | '/reports' | '/alerts'
  icon: ReactNode
  count: number
  label: string
  hint?: string
  urgent?: boolean
}) {
  return (
    <li>
      <Link
        to={to}
        className="group flex h-full items-center gap-3 rounded-xl border bg-card p-4 shadow-elevation-1 transition-[border-color,transform] duration-(--duration-fast) ease-(--ease-out) outline-none hover:-translate-y-px hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <span
          className={cn(
            'grid size-10 shrink-0 place-items-center rounded-lg [&>svg]:size-5',
            urgent ? 'bg-primary-subtle text-primary-subtle-foreground' : 'bg-muted text-muted-foreground',
          )}
          aria-hidden
        >
          {icon}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-baseline gap-2">
            <span className="text-xl leading-none font-semibold tabular-nums">{formatInteger(count)}</span>
            <span className="truncate text-xs font-medium">{label}</span>
          </span>
          {hint && <span className="truncate text-2xs text-muted-foreground">{hint}</span>}
        </span>
        <ArrowUpRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform duration-(--duration-fast) group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-foreground"
        />
      </Link>
    </li>
  )
}
