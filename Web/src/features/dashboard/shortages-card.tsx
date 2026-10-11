import { Map as MapIcon } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'

import type { Dashboard } from '@/api/schemas'
import { EmptyState } from '@/components/feedback/empty-state'
import { NoShortageIllustration } from '@/components/feedback/illustrations'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { t } from '@/i18n'
import { formatInteger, formatLatLng, formatPercent } from '@/lib/format'
import { cn } from '@/lib/utils'

const ShortagesMap = lazy(() => import('./shortages-map'))

/** Top des zones en pénurie : classement, taux sans station ouverte à 5 km, carte à la demande. */
export function ShortagesCard({ data, className }: { data: Dashboard; className?: string }) {
  const [showMap, setShowMap] = useState(false)
  const { top, zones, k, threshold } = data.shortages
  return (
    <Card className={cn('@container min-w-0', className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t.dashboard.shortages}
          {zones > 0 && <Badge variant="danger">{t.dashboard.shortagesCount(formatInteger(zones), zones > 1)}</Badge>}
        </CardTitle>
        <CardDescription>{t.dashboard.shortagesDesc(k, formatPercent(threshold))}</CardDescription>
        {top.length > 0 && (
          <CardAction>
            <Button variant="outline" size="sm" aria-pressed={showMap} onClick={() => setShowMap((s) => !s)}>
              <MapIcon aria-hidden />
              {showMap ? t.dashboard.hideMap : t.dashboard.showMap}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {top.length === 0 ? (
          <EmptyState
            size="sm"
            illustration={<NoShortageIllustration />}
            title={t.dashboard.noShortage}
            description={t.dashboard.noShortageBody}
          />
        ) : (
          <>
            {showMap && (
              <Suspense fallback={<Skeleton className="h-72 w-full rounded-lg" />}>
                <ShortagesMap zones={top} />
              </Suspense>
            )}
            <div className="-mx-5 overflow-x-auto">
              <Table className="min-w-[520px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-8 w-10 pl-5 text-2xs">#</TableHead>
                    <TableHead className="h-8 text-2xs">{t.dashboard.zone}</TableHead>
                    <TableHead className="h-8 text-right text-2xs">{t.dashboard.searches}</TableHead>
                    <TableHead className="h-8 text-right text-2xs">{t.dashboard.emptySearches}</TableHead>
                    <TableHead className="h-8 w-[30%] pr-5 text-2xs">{t.dashboard.rate}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {top.map((z, i) => (
                    <TableRow key={z.cell}>
                      <TableCell className="py-2 pl-5 text-xs text-muted-foreground tabular-nums">{i + 1}</TableCell>
                      <TableCell className="py-2 text-xs">
                        <span className="font-medium">{formatLatLng(z.center.lat, z.center.lng)}</span>
                        <span className="ml-2 hidden font-mono text-2xs text-muted-foreground @2xl:inline">
                          {z.cell}
                        </span>
                      </TableCell>
                      <TableCell className="py-2 text-right text-xs tabular-nums">
                        {formatInteger(z.searches)}
                      </TableCell>
                      <TableCell className="py-2 text-right text-xs tabular-nums">
                        {formatInteger(z.emptySearches)}
                      </TableCell>
                      <TableCell className="py-2 pr-5">
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                            <span
                              className="block h-full rounded-full bg-primary"
                              style={{ width: `${Math.min(1, z.emptyRate) * 100}%` }}
                            />
                          </span>
                          <span className="w-10 text-right text-xs font-medium tabular-nums">
                            {formatPercent(z.emptyRate)}
                          </span>
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
