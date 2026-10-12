import { CheckCircle2, Clock3, XCircle } from 'lucide-react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import type { Dashboard } from '@/api/schemas'
import { EmptyState } from '@/components/feedback/empty-state'
import { EmptyChartIllustration } from '@/components/feedback/illustrations'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { t } from '@/i18n'
import { formatBucket, formatBucketLong, formatAxis, formatInteger, formatPercent } from '@/lib/format'

import { ChartCard, type DataTable } from './chart-card'

// Statuts réservés (palette dataviz) : toujours avec une icône et un libellé.
const statuses = [
  { key: 'fresh', color: 'var(--status-good)', icon: CheckCircle2 },
  { key: 'stale', color: 'var(--status-warning)', icon: Clock3 },
  { key: 'expired', color: 'var(--status-critical)', icon: XCircle },
] as const

const config = {
  fresh: { label: t.dashboard.freshnessShort.fresh, color: 'var(--status-good)' },
  stale: { label: t.dashboard.freshnessShort.stale, color: 'var(--status-warning)' },
  expired: { label: t.dashboard.freshnessShort.expired, color: 'var(--status-critical)' },
} satisfies ChartConfig

export function FreshnessCard({ data, className }: { data: Dashboard; className?: string }) {
  const f = data.stockFreshness
  const { granularity, timezone } = data.period
  const series = data.series.freshness
  const hasSeries = series.some((p) => p.fresh !== null)
  const shares = { fresh: f.freshShare, stale: f.staleShare, expired: f.expiredShare }
  const counts = { fresh: f.fresh, stale: f.stale, expired: f.expired }

  const table: DataTable = {
    caption: t.dashboard.freshnessChart,
    columns: [
      { key: 'at', label: t.dashboard.date },
      ...statuses.map((s) => ({ key: s.key, label: t.dashboard.freshnessShort[s.key], numeric: true })),
    ],
    rows: series.map((p) => ({
      at: formatBucketLong(p.at, granularity, timezone),
      fresh: p.fresh === null ? '—' : formatInteger(p.fresh),
      stale: p.stale === null ? '—' : formatInteger(p.stale),
      expired: p.expired === null ? '—' : formatInteger(p.expired),
    })),
  }

  return (
    <ChartCard
      className={className}
      title={t.dashboard.freshnessChart}
      description={t.dashboard.freshnessChartDesc}
      summary={t.dashboard.freshnessSummary(formatInteger(f.fresh), formatInteger(f.stale), formatInteger(f.expired))}
      table={hasSeries ? table : undefined}
    >
      <div className="flex flex-col gap-4">
        {/* Instantané : barre de répartition + valeurs étiquetées. */}
        <div className="flex flex-col gap-3">
          <div className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted">
            {f.total > 0 &&
              statuses.map((s) =>
                shares[s.key] > 0 ? (
                  <span
                    key={s.key}
                    className="h-full first:rounded-l-full last:rounded-r-full"
                    style={{ width: `${shares[s.key] * 100}%`, background: s.color }}
                  />
                ) : null,
              )}
          </div>
          <ul className="grid grid-cols-3 gap-2">
            {statuses.map(({ key, color, icon: Icon }) => (
              <li key={key} className="flex flex-col gap-0.5">
                <span className="flex items-center gap-1 text-2xs text-muted-foreground">
                  <Icon className="size-3.5 shrink-0" style={{ color }} aria-hidden />
                  {t.dashboard.freshnessShort[key]}
                </span>
                <span className="text-base font-semibold tabular-nums">
                  {formatInteger(counts[key])}
                  <span className="ml-1 text-2xs font-normal text-muted-foreground">{formatPercent(shares[key])}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-2xs text-muted-foreground">{t.dashboard.freshnessThresholds}</p>
        </div>
        {hasSeries ? (
          <ChartContainer config={config} className="aspect-auto h-[150px] w-full">
            <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis
                dataKey="at"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={28}
                tickFormatter={(v: string) => formatBucket(v, granularity, timezone)}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={44}
                allowDecimals={false}
                tickFormatter={(v: number) => formatAxis(v)}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    indicator="line"
                    labelFormatter={(_, payload) => {
                      const at = payload?.[0]?.payload?.at as string | undefined
                      return at ? formatBucketLong(at, granularity, timezone) : ''
                    }}
                  />
                }
              />
              {statuses.map((s) => (
                <Area
                  key={s.key}
                  dataKey={s.key}
                  type="monotone"
                  stackId="freshness"
                  stroke={s.color}
                  strokeWidth={2}
                  fill={s.color}
                  fillOpacity={0.1}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ChartContainer>
        ) : (
          <EmptyState
            size="sm"
            illustration={<EmptyChartIllustration className="h-16 w-20" />}
            title={t.dashboard.noFreshness}
            description={t.dashboard.noFreshnessBody}
          />
        )}
      </div>
    </ChartCard>
  )
}
