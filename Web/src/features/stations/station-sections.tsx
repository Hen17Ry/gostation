import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CalendarOff, Mail, MailCheck, Network, Phone } from 'lucide-react'

import { reportsQuery, stationTimelineQuery } from '@/api/admin'
import type { OpeningHours, Station, Stock } from '@/api/admin-schemas'
import { DefinitionList } from '@/components/data/definition-list'
import { ErrorState } from '@/components/feedback/error-state'
import { FreshnessBadge } from '@/components/status/badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { actionLabel, actorName, auditSummary } from '@/features/audit/describe'
import { ta } from '@/i18n/admin'
import { formatDateTime, formatDay, formatRelative, formatTime } from '@/lib/format'
import { cn } from '@/lib/utils'

export function InfoCard({ s }: { s: Station }) {
  const f = ta.station.fields
  return (
    <Card>
      <CardHeader>
        <CardTitle>{ta.station.sections.info}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <DefinitionList
          items={[
            { label: f.name!, value: s.name },
            { label: f.brand!, value: s.brand ?? ta.common.none },
            { label: f.ifu!, value: <IfuValue ifu={s.ifu} sharedCount={s.ifuSharedCount} /> },
            { label: f.rccm!, value: <span className="font-mono">{s.rccm}</span> },
            { label: f.address!, value: s.address, wide: true },
            { label: f.city!, value: s.city ?? ta.common.none },
            {
              label: f.phone!,
              value: (
                <a
                  href={`tel:${s.phone}`}
                  className="inline-flex items-center gap-1.5 text-brand-text underline-offset-4 hover:underline"
                >
                  <Phone className="size-3.5" aria-hidden />
                  {s.phone}
                </a>
              ),
            },
            { label: f.createdAt!, value: formatDateTime(s.createdAt) },
            {
              label: f.statusChangedAt!,
              value: `${formatDateTime(s.statusChangedAt)} (${formatRelative(s.statusChangedAt)})`,
            },
          ]}
        />
        <div className="flex flex-col gap-2 border-t pt-4">
          <h3 className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
            {ta.station.sections.manager}
          </h3>
          {s.manager ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-medium">
                {s.manager.firstName} {s.manager.lastName}
              </span>
              <a
                href={`mailto:${s.manager.email}`}
                className="inline-flex items-center gap-1.5 text-brand-text underline-offset-4 hover:underline"
              >
                <Mail className="size-3.5" aria-hidden />
                {s.manager.email}
              </a>
              <Badge variant={s.manager.emailVerified ? 'success' : 'warning'}>
                <MailCheck aria-hidden />
                {s.manager.emailVerified ? ta.station.emailVerified : ta.station.emailNotVerified}
              </Badge>
              <Button asChild variant="link" size="sm" className="h-auto text-xs">
                <Link to="/users" search={{ q: s.manager.email, user: s.manager.id }}>
                  {ta.common.details}
                </Link>
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{ta.station.noManager}</p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * IFU de la station et, s'il est déclaré par d'autres stations (un IFU peut couvrir un réseau, D66),
 * un lien vers la liste de toutes les stations qui le déclarent. Information neutre, pas une alerte.
 */
export function IfuValue({ ifu, sharedCount }: { ifu: string; sharedCount: number }) {
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className="font-mono">{ifu}</span>
      {sharedCount > 0 && (
        <Button asChild variant="link" size="sm" className="h-auto px-0 text-xs">
          <Link to="/stations" search={{ status: 'all', q: ifu }}>
            <Network aria-hidden />
            {ta.station.ifuShared(sharedCount)}
          </Link>
        </Button>
      )}
    </span>
  )
}

/** « 06:00 – 22:00 », « 24 h/24 » ou « Fermé ». */
function dayRanges(day: OpeningHours['days'][number] | undefined): string {
  if (!day) return ta.station.closedDay
  if (day.is24h) return ta.station.allDay
  return day.ranges.map((r) => `${r.opens} – ${r.closes}`).join(', ')
}

function reopens(next: string, tz: string): string {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz })
  const day = new Date(next).toLocaleDateString('en-CA', { timeZone: tz })
  const time = formatTime(next, tz)
  if (day === today) return ta.station.reopens(`à ${time}`)
  return ta.station.reopens(`${formatDay(next, tz)} à ${time}`)
}

export function HoursCard({ hours }: { hours: OpeningHours }) {
  const byDay = new Map(hours.days.map((d) => [d.weekday, d]))
  const todayIso = ((new Date().getDay() + 6) % 7) + 1
  return (
    <Card>
      <CardHeader className="grid-cols-[1fr_auto]">
        <CardTitle>{ta.station.sections.hours}</CardTitle>
        {hours.days.length > 0 && (
          <div className="col-start-2 row-span-2 row-start-1 flex items-center gap-2 text-xs">
            <Badge variant={hours.isOpenNow ? 'success' : 'secondary'}>
              {hours.isOpenNow ? ta.station.openNow : ta.station.closedNow}
            </Badge>
            {!hours.isOpenNow && hours.nextOpening && (
              <span className="text-muted-foreground">{reopens(hours.nextOpening, hours.timezone)}</span>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {hours.days.length === 0 ? (
          <p className="rounded-lg bg-warning-subtle px-3 py-2 text-xs text-warning-subtle-foreground">
            {ta.station.noHours}
          </p>
        ) : (
          <table className="w-full text-sm">
            <caption className="sr-only">{ta.station.sections.hours}</caption>
            <tbody>
              {ta.station.weekdays.map((name, i) => {
                const day = byDay.get(i + 1)
                const today = i + 1 === todayIso
                return (
                  <tr key={name} className={cn('border-b last:border-0', today && 'font-medium')}>
                    <th scope="row" className="py-1.5 pr-4 text-left font-normal text-muted-foreground">
                      {name}
                    </th>
                    <td className={cn('py-1.5 text-right tabular-nums', !day && 'text-muted-foreground')}>
                      {dayRanges(day)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
        <div className="flex flex-col gap-2">
          <h3 className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">
            {ta.station.sections.closures}
          </h3>
          {hours.closures.length === 0 ? (
            <p className="text-xs text-muted-foreground">{ta.station.noClosures}</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {hours.closures.map((c) => (
                <li key={c.id} className="flex items-center gap-2 text-sm">
                  <CalendarOff className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="font-medium first-letter:uppercase">{formatDay(c.date)}</span>
                  <span className="truncate text-muted-foreground">{c.reason ?? ta.station.closureNoReason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

const quantity = (s: Stock) =>
  s.unit === 'cylinder' ? ta.station.units.cylinder(s.quantity) : ta.station.units.liter(s.quantity)

export function StocksCard({ stocks, lastUpdate }: { stocks: Stock[]; lastUpdate: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{ta.station.sections.stocks}</CardTitle>
        <CardDescription>
          {ta.station.stocksReadonly}
          {lastUpdate && <> · {ta.common.updatedAgo(formatRelative(lastUpdate))}</>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {stocks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{ta.station.noStocks}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{ta.station.sections.stocks}</caption>
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 text-left font-medium">
                    {ta.station.stockColumns.product}
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    {ta.station.stockColumns.quantity}
                  </th>
                  <th scope="col" className="py-2 pr-3 text-left font-medium">
                    {ta.station.stockColumns.freshness}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {ta.station.stockColumns.updated}
                  </th>
                </tr>
              </thead>
              <tbody>
                {stocks.map((s) => (
                  <tr key={s.productId} className="border-b last:border-0">
                    <th scope="row" className="py-2 pr-3 text-left font-medium">
                      {s.label}
                    </th>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {s.quantity === 0 ? <Badge variant="danger">{ta.station.outOfStock}</Badge> : quantity(s)}
                    </td>
                    <td className="py-2 pr-3">
                      <FreshnessBadge freshness={s.freshness} at={s.freshAt} />
                    </td>
                    <td className="py-2 text-right text-xs whitespace-nowrap text-muted-foreground">
                      {formatRelative(s.freshAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function TimelineCard({ id }: { id: string }) {
  const q = useQuery(stationTimelineQuery(id))
  return (
    <Card>
      <CardHeader className="grid-cols-[1fr_auto]">
        <CardTitle>{ta.station.sections.timeline}</CardTitle>
        <Button asChild variant="link" size="sm" className="col-start-2 row-start-1 h-auto text-xs">
          <Link to="/audit" search={{ entityType: 'station', entityId: id }}>
            {ta.station.timelineMore}
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {q.isPending ? (
          <div className="flex flex-col gap-4" aria-hidden>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} size="sm" />
        ) : q.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{ta.station.timelineEmpty}</p>
        ) : (
          <ol aria-label={ta.station.sections.timeline} className="relative flex flex-col gap-4 border-l pl-5">
            {q.data.items.map((e) => {
              const summary = auditSummary(e)
              const admin = e.action.startsWith('admin.')
              return (
                <li key={e.id} className="relative">
                  <span
                    aria-hidden
                    className={cn(
                      'absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-card',
                      admin ? 'bg-primary' : 'bg-border-strong',
                    )}
                  />
                  <p className="text-sm font-medium">{actionLabel(e.action)}</p>
                  <p className="text-2xs text-muted-foreground">
                    <time dateTime={e.createdAt} title={formatDateTime(e.createdAt)}>
                      {formatRelative(e.createdAt)}
                    </time>{' '}
                    · {ta.station.timelineBy(actorName(e))}
                  </p>
                  {summary && <p className="mt-1 text-xs break-words text-muted-foreground">{summary}</p>}
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

export function OpenReportsCard({ id }: { id: string }) {
  const q = useQuery(reportsQuery({ status: 'open', stationId: id }))
  return (
    <Card>
      <CardHeader className="grid-cols-[1fr_auto]">
        <CardTitle>
          {ta.station.sections.reports}
          {q.data && q.data.items.length > 0 && (
            <Badge variant="warning" className="ml-2 align-middle">
              {q.data.items.length}
            </Badge>
          )}
        </CardTitle>
        <Button asChild variant="link" size="sm" className="col-start-2 row-start-1 h-auto text-xs">
          <Link to="/reports" search={{ stationId: id }}>
            {ta.common.viewAll}
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {q.isPending ? (
          <Skeleton className="h-16" />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} size="sm" />
        ) : q.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{ta.station.noOpenReports}</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {q.data.items.map((r) => (
              <li key={r.id} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    to="/reports"
                    search={{ stationId: id, report: r.id }}
                    className="text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {ta.reports.reasons[r.reason]}
                    {r.product && <span className="font-normal text-muted-foreground"> · {r.product.label}</span>}
                  </Link>
                  <time className="text-2xs whitespace-nowrap text-muted-foreground" dateTime={r.createdAt}>
                    {formatRelative(r.createdAt)}
                  </time>
                </div>
                {r.comment && <p className="line-clamp-2 text-xs text-muted-foreground">{r.comment}</p>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
