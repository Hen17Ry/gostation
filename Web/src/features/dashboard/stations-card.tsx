import { Link } from '@tanstack/react-router'

import type { Dashboard } from '@/api/schemas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { t } from '@/i18n'
import { formatInteger, formatPercent } from '@/lib/format'

const order = [
  { key: 'approved', variant: 'success' },
  { key: 'pending', variant: 'warning' },
  { key: 'suspended', variant: 'danger' },
  { key: 'rejected', variant: 'secondary' },
] as const

/** Répartition des stations par statut (instantané). */
export function StationsCard({ data, className }: { data: Dashboard; className?: string }) {
  const by = data.stations.byStatus
  const total = Object.values(by).reduce((a, b) => a + b, 0)
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{t.dashboard.stationsByStatus}</CardTitle>
        <CardAction>
          <Button asChild variant="link" size="sm" className="text-xs">
            <Link to="/stations">{t.dashboard.open}</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-3xl leading-none font-semibold tracking-tight tabular-nums">
          {formatInteger(total)}
          <span className="ml-2 text-xs font-normal text-muted-foreground">stations</span>
        </p>
        <ul className="flex flex-col divide-y">
          {order.map(({ key, variant }) => {
            const n = by[key] ?? 0
            return (
              <li key={key} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <Badge variant={variant}>{t.dashboard.statuses[key]}</Badge>
                <span className="flex items-baseline gap-2 text-sm tabular-nums">
                  <span className="font-medium">{formatInteger(n)}</span>
                  <span className="w-10 text-right text-2xs text-muted-foreground">
                    {total ? formatPercent(n / total) : '—'}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
