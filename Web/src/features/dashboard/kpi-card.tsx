import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import type { ReactNode } from 'react'

import type { Kpi } from '@/api/schemas'
import { Skeleton } from '@/components/ui/skeleton'
import { t } from '@/i18n'
import { formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

/*
 * Carte d'indicateur, adaptée du « KpiCard » de 21st.dev (uvain, Charts & KPI Cards) : la carte
 * sait si une hausse est une bonne nouvelle (recherches) ou une mauvaise (taux sans résultat,
 * signalements) ; la tendance porte une flèche, un signe et un libellé lu par les lecteurs
 * d'écran, jamais la couleur seule.
 */
export function KpiCard({
  label,
  hint,
  kpi,
  format,
  good = 'up',
  icon,
  trend,
  className,
}: {
  label: string
  /** Définition de l'indicateur (info-bulle et lecteurs d'écran). */
  hint?: string
  kpi: Kpi
  format: (n: number) => string
  /** Sens favorable d'une hausse. */
  good?: 'up' | 'down'
  icon?: ReactNode
  /** Petite série (sparkline), du plus ancien au plus récent. */
  trend?: number[]
  className?: string
}) {
  return (
    <div
      className={cn('@container/kpi flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-elevation-1', className)}
    >
      <dl className="flex flex-col gap-2">
        <dt className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground" title={hint}>
          {icon && <span className="shrink-0 text-muted-foreground [&>svg]:size-4">{icon}</span>}
          <span className="truncate">{label}</span>
          {hint && <span className="sr-only"> : {hint}</span>}
        </dt>
        <dd className="flex items-end justify-between gap-3">
          <span className="text-2xl leading-none font-semibold tracking-tight tabular-nums">{format(kpi.value)}</span>
          {trend && trend.length > 1 && <Sparkline values={trend} />}
        </dd>
        <dd>
          <Delta change={kpi.change} good={good} />
        </dd>
      </dl>
    </div>
  )
}

export function Delta({ change, good }: { change: number | null; good: 'up' | 'down' }) {
  if (change === null) {
    return <span className="text-2xs text-muted-foreground">{t.dashboard.noPrevious}</span>
  }
  const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
  const favorable = direction === 'flat' ? null : direction === good
  const Icon = direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus
  const word = direction === 'up' ? t.dashboard.up : direction === 'down' ? t.dashboard.down : t.dashboard.stable
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-2xs whitespace-nowrap">
      <span
        className={cn(
          'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium tabular-nums',
          favorable === true && 'bg-success-subtle text-success-subtle-foreground',
          favorable === false && 'bg-danger-subtle text-danger-subtle-foreground',
          favorable === null && 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="size-3" aria-hidden />
        <span className="sr-only">{word} de </span>
        {formatPercent(Math.abs(change))}
      </span>
      <span className="truncate text-muted-foreground">
        <span className="@[12.5rem]/kpi:hidden">{t.dashboard.vsPreviousShort}</span>
        <span className="hidden @[12.5rem]/kpi:inline">{t.dashboard.vsPrevious}</span>
      </span>
    </span>
  )
}

/** Mini-série en SVG (sans bibliothèque) : 2 px, extrémité marquée, décorative. */
function Sparkline({ values }: { values: number[] }) {
  const w = 72
  const h = 28
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const pts = values.map(
    (v, i) => [(i / (values.length - 1)) * (w - 4) + 2, h - 3 - ((v - min) / span) * (h - 6)] as const,
  )
  const last = pts.at(-1)!
  return (
    <svg aria-hidden viewBox={`0 0 ${w} ${h}`} className="h-7 w-18 shrink-0 overflow-visible">
      <polyline
        points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        className="stroke-chart-1"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r="2.5" className="fill-chart-1 stroke-card" strokeWidth="1.5" />
    </svg>
  )
}

export function KpiCardSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex h-[118px] flex-col gap-3 rounded-xl border bg-card p-4 shadow-elevation-1', className)}>
      <Skeleton className="h-3.5 w-28" />
      <Skeleton className="h-6 w-20" />
      <Skeleton className="h-4 w-36" />
    </div>
  )
}
