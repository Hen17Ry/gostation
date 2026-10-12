import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from 'recharts'

import type { Dashboard } from '@/api/schemas'
import { EmptyState } from '@/components/feedback/empty-state'
import { EmptyChartIllustration } from '@/components/feedback/illustrations'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { t } from '@/i18n'
import { formatBucket, formatBucketLong, formatAxis, formatInteger, formatRange } from '@/lib/format'

import { ChartCard, type DataTable, Legend } from './chart-card'
import { isPartialBucket } from './period'
import { productSlots } from './products'

export function SearchesChart({ data, className }: { data: Dashboard; className?: string }) {
  const { granularity, timezone } = data.period
  const products = productSlots(data)
  const rows = data.series.searches.map((pt) => ({
    at: pt.at,
    total: pt.searches,
    ...Object.fromEntries(products.map((p) => [p.code, pt.byProduct[p.code] ?? 0])),
  }))
  const total = data.searches.total.value
  const partial = rows.map((r) => isPartialBucket(r.at, granularity, data.period.to))
  const config = Object.fromEntries(
    products.map((p) => [p.code, { label: p.label, color: p.color }]),
  ) satisfies ChartConfig

  const table: DataTable = {
    caption: t.dashboard.searchesChart,
    columns: [
      { key: 'at', label: t.dashboard.date },
      ...products.map((p) => ({ key: p.code, label: p.label, numeric: true })),
      { key: 'total', label: t.dashboard.total, numeric: true },
    ],
    rows: rows.map((r) => ({
      ...Object.fromEntries(products.map((p) => [p.code, formatInteger(Number(r[p.code as keyof typeof r] ?? 0))])),
      at: formatBucketLong(r.at, granularity, timezone),
      total: formatInteger(r.total),
    })),
  }

  return (
    <ChartCard
      className={className}
      title={t.dashboard.searchesChart}
      description={t.dashboard.searchesChartDesc(granularity)}
      summary={t.dashboard.searchesChartSummary(
        formatInteger(total),
        formatRange(data.period.from, data.period.to, timezone),
      )}
      table={total > 0 ? table : undefined}
    >
      {total === 0 ? (
        <EmptyState
          size="sm"
          illustration={<EmptyChartIllustration />}
          title={t.dashboard.noSearches}
          description={t.dashboard.noSearchesBody}
          className="h-[260px]"
        />
      ) : (
        <div className="flex flex-col gap-3">
          <Legend items={products.map((p) => ({ key: p.code, label: p.label, color: p.color }))} />
          <ChartContainer config={config} className="aspect-auto h-[240px] w-full">
            <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barCategoryGap="22%">
              <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
              <XAxis
                dataKey="at"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={granularity === 'hour' ? 28 : 12}
                tickFormatter={(v: string) => formatBucket(v, granularity, timezone)}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={44}
                tickFormatter={(v: number) => formatAxis(v)}
                allowDecimals={false}
              />
              <ChartTooltip
                cursor={{ fill: 'var(--muted)', opacity: 0.7 }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => {
                      const at = payload?.[0]?.payload?.at as string | undefined
                      return at ? formatBucketLong(at, granularity, timezone) : ''
                    }}
                  />
                }
              />
              {products.map((p, i) => (
                <Bar
                  key={p.code}
                  dataKey={p.code}
                  stackId="searches"
                  fill={p.color}
                  stroke="var(--card)"
                  strokeWidth={1}
                  maxBarSize={28}
                  radius={i === products.length - 1 ? [4, 4, 0, 0] : 0}
                  isAnimationActive={false}
                >
                  {rows.map((r, j) => (
                    <Cell key={r.at} fillOpacity={partial[j] ? 0.4 : 1} />
                  ))}
                </Bar>
              ))}
            </BarChart>
          </ChartContainer>
          {partial.at(-1) && <p className="text-2xs text-muted-foreground">{t.dashboard.partialBucket}</p>}
        </div>
      )}
    </ChartCard>
  )
}
