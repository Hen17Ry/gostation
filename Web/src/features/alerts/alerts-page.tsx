import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { ArrowRight, BellOff, MapPinned, UserX } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { type AlertFilters, alertsQuery, resolveAlert, stationsQuery } from '@/api/admin'
import type { Alert, StationSummary } from '@/api/admin-schemas'
import { alertKeys, counterKeys, stationKeys } from '@/api/keys'
import { CursorPager } from '@/components/data/cursor-pager'
import { DataTable } from '@/components/data/data-table'
import { columnHelper } from '@/components/data/table-features'
import { FilterSelect, StatusTabs } from '@/components/data/filters'
import { PageHeader } from '@/components/data/page-header'
import { useCursorPages } from '@/components/data/use-cursor-pages'
import { ReasonDialog } from '@/components/dialogs/reason-dialog'
import { EmptyState } from '@/components/feedback/empty-state'
import { AllClearIllustration, EmptyListIllustration } from '@/components/feedback/illustrations'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ta } from '@/i18n/admin'
import { formatDateTime, formatRelative } from '@/lib/format'
import { type AlertSearch, toAlertFilters } from './filters'

const route = getRouteApi('/_app/alerts')

const KIND_ICON = { manager_inactive: UserX, reports_threshold: BellOff, location: MapPinned }

function KindBadge({ kind }: { kind: keyof typeof KIND_ICON }) {
  const Icon = KIND_ICON[kind]
  return (
    <Badge variant={kind === 'reports_threshold' ? 'danger' : kind === 'location' ? 'info' : 'warning'}>
      <Icon aria-hidden />
      {ta.alerts.kinds[kind]}
    </Badge>
  )
}

function alertDetail(a: Alert): string {
  if (a.kind === 'manager_inactive') {
    const n = Number(a.details.ignoredReminders ?? 3)
    return ta.alerts.ignoredReminders(n)
  }
  const reason = a.reason ? ta.reports.reasons[a.reason]! : ''
  const reporters = Number(a.details.reporters ?? 5)
  return `${ta.alerts.reasonFor(reason, a.product?.label)} · ${ta.alerts.reporters(reporters)}`
}

function AlertStatus({ a }: { a: Alert }) {
  if (!a.resolvedAt) return <Badge variant="warning">{ta.alerts.open}</Badge>
  return (
    <span className="flex flex-col">
      <Badge variant="secondary">{a.resolvedBy ? ta.alerts.resolvedBy : ta.alerts.resolvedAuto}</Badge>
      {a.resolution && (
        <span className="mt-0.5 line-clamp-1 max-w-48 text-2xs text-muted-foreground">{a.resolution}</span>
      )}
    </span>
  )
}

const EMPTY_ALERTS: Alert[] = []
const EMPTY_STATIONS: StationSummary[] = []

export function AlertsPage({ search }: { search: AlertSearch }) {
  const navigate = route.useNavigate()
  const filters = toAlertFilters(search)
  const update = (patch: Partial<AlertSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, cursor: undefined }), replace: true })
  const kindOptions = [
    { value: 'all' as const, label: ta.common.allFem },
    ...(['manager_inactive', 'reports_threshold', 'location'] as const).map((k) => ({
      value: k,
      label: ta.alerts.kinds[k]!,
    })),
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={ta.alerts.title} description={ta.alerts.subtitle} />
      {filters === null ? (
        <PinsTable
          toolbar={
            <FilterSelect
              label={ta.alerts.kindFilter}
              value="location"
              onChange={(v) => update({ kind: v === 'all' ? undefined : v })}
              options={kindOptions}
            />
          }
        />
      ) : (
        <>
          {filters.status === 'open' && !filters.kind && <PinsSummary />}
          <AlertsTable
            search={search}
            filters={filters}
            toolbar={
              <>
                <StatusTabs
                  label={ta.station.statusFilter}
                  value={filters.status}
                  onChange={(status) => update({ status: status === 'open' ? undefined : status })}
                  options={(['open', 'resolved', 'all'] as const).map((s) => ({
                    value: s,
                    label: ta.alerts.statusTabs[s]!,
                  }))}
                />
                <FilterSelect
                  label={ta.alerts.kindFilter}
                  value={search.kind ?? 'all'}
                  onChange={(v) => update({ kind: v === 'all' ? undefined : v })}
                  options={kindOptions}
                />
              </>
            }
          />
        </>
      )}
    </div>
  )
}

function AlertsTable({
  search,
  filters,
  toolbar,
}: {
  search: AlertSearch
  filters: AlertFilters
  toolbar: React.ReactNode
}) {
  const navigate = route.useNavigate()
  const qc = useQueryClient()
  const q = useQuery(alertsQuery(filters))
  const [closing, setClosing] = useState<Alert | null>(null)
  const { cursor: _c, ...rest } = filters
  const pages = useCursorPages(
    search.cursor,
    (cursor) => void navigate({ search: (prev) => ({ ...prev, cursor }) }),
    JSON.stringify(rest),
  )

  const col = columnHelper<Alert>()
  const columns = [
    col.accessor('kind', {
      header: ta.alerts.columns.kind,
      meta: { hideable: false },
      cell: (c) => <KindBadge kind={c.getValue()} />,
    }),
    col.accessor((a) => a.station.name, {
      id: 'station',
      header: ta.alerts.columns.station,
      cell: ({ row }) => (
        <Link
          to="/stations/$stationId"
          params={{ stationId: row.original.station.id }}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.original.station.name}
        </Link>
      ),
    }),
    col.display({
      id: 'detail',
      header: ta.alerts.columns.detail,
      meta: { label: ta.alerts.columns.detail },
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{alertDetail(row.original)}</span>,
    }),
    col.accessor('createdAt', {
      header: ta.alerts.columns.createdAt,
      cell: (c) => (
        <time
          className="text-xs whitespace-nowrap text-muted-foreground"
          dateTime={c.getValue()}
          title={formatDateTime(c.getValue())}
        >
          {formatRelative(c.getValue())}
        </time>
      ),
    }),
    col.accessor('resolvedAt', {
      header: ta.alerts.columns.status,
      cell: ({ row }) => <AlertStatus a={row.original} />,
    }),
    col.display({
      id: 'actions',
      header: () => <span className="sr-only">{ta.alerts.resolve}</span>,
      meta: { hideable: false, className: 'text-right' },
      cell: ({ row }) =>
        !row.original.resolvedAt && (
          <Button size="sm" variant="outline" onClick={() => setClosing(row.original)}>
            {ta.alerts.resolve}
          </Button>
        ),
    }),
  ]

  const items = q.data?.items ?? EMPTY_ALERTS
  return (
    <>
      <DataTable
        caption={ta.alerts.title}
        columns={columns}
        data={items}
        getRowId={(a) => a.id}
        storageKey="alerts"
        isLoading={q.isPending}
        isFetching={q.isPlaceholderData}
        error={q.error}
        onRetry={() => void q.refetch()}
        toolbar={toolbar}
        empty={
          filters.status === 'open' ? (
            <EmptyState
              illustration={<AllClearIllustration />}
              title={ta.alerts.emptyOpen}
              description={ta.alerts.emptyOpenBody}
            />
          ) : (
            <EmptyState illustration={<EmptyListIllustration />} title={ta.alerts.empty} />
          )
        }
        footer={
          <CursorPager
            page={pages.page}
            hasPrevious={pages.hasPrevious}
            nextCursor={q.data?.nextCursor}
            onPrevious={pages.previous}
            onNext={pages.next}
          />
        }
      />
      <ReasonDialog
        open={closing !== null}
        onOpenChange={(o) => !o && setClosing(null)}
        title={ta.alerts.resolveTitle}
        description={
          closing ? `${ta.alerts.kinds[closing.kind]} · ${closing.station.name}. ${ta.alerts.resolveBody}` : ''
        }
        confirmLabel={ta.alerts.resolve}
        reasonRequired={false}
        reasonLabel={ta.common.note}
        reasonHint={ta.common.noteHint}
        onConfirm={async (note) => {
          // Garde explicite (pas de `closing!`) : le React Compiler lirait `closing.id` au rendu.
          if (!closing) return
          await resolveAlert(closing.id, note || undefined)
          void qc.invalidateQueries({ queryKey: alertKeys.all })
          void qc.invalidateQueries({ queryKey: counterKeys.all })
          void qc.invalidateQueries({ queryKey: stationKeys.lists() })
          toast.success(ta.alerts.resolved)
        }}
      />
    </>
  )
}

const pinsFilters = { status: 'all' as const, needsReview: true }

/** Épingles à vérifier (stations) : résumé au-dessus des alertes ouvertes. */
function PinsSummary() {
  const q = useQuery(stationsQuery({ ...pinsFilters, limit: 5 }))
  if (q.isPending) return <Skeleton className="h-24 rounded-xl" />
  if (q.isError || q.data.items.length === 0) return null
  return (
    <Card>
      <CardHeader className="grid-cols-[1fr_auto]">
        <CardTitle className="flex items-center gap-2">
          <MapPinned className="size-4 text-info" aria-hidden />
          {ta.alerts.pinsTitle}
        </CardTitle>
        <CardDescription>{ta.alerts.pinsBody}</CardDescription>
        <Button
          asChild
          variant="link"
          size="sm"
          className="col-start-2 row-span-2 row-start-1 h-auto self-center text-xs"
        >
          <Link to="/alerts" search={{ kind: 'location' }}>
            {ta.common.viewAll}
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y">
          {q.data.items.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{s.name}</span>
                <span className="text-2xs text-muted-foreground">
                  {s.hasPendingMove ? ta.alerts.pinMove : ta.alerts.pinFlagged}
                  {s.city && <> · {s.city}</>}
                </span>
              </div>
              <Button asChild size="sm" variant="outline">
                <Link to="/stations/$stationId" params={{ stationId: s.id }}>
                  {ta.alerts.review}
                  <ArrowRight aria-hidden />
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function PinsTable({ toolbar }: { toolbar: React.ReactNode }) {
  const navigate = route.useNavigate()
  const q = useQuery(stationsQuery(pinsFilters))
  const col = columnHelper<StationSummary>()
  const columns = [
    col.display({
      id: 'kind',
      header: ta.alerts.columns.kind,
      meta: { hideable: false },
      cell: ({ row }) => (
        <Badge variant="info">
          <MapPinned aria-hidden />
          {row.original.hasPendingMove ? ta.alerts.pinMove : ta.alerts.pinFlagged}
        </Badge>
      ),
    }),
    col.accessor('name', {
      header: ta.alerts.columns.station,
      cell: ({ row }) => (
        <Link
          to="/stations/$stationId"
          params={{ stationId: row.original.id }}
          className="font-medium underline-offset-4 hover:underline"
        >
          {row.original.name}
        </Link>
      ),
    }),
    col.accessor('city', { header: ta.station.columns.city, cell: (c) => c.getValue() ?? ta.common.none }),
    col.accessor('updatedAt', {
      header: ta.alerts.columns.createdAt,
      cell: (c) => <span className="text-xs text-muted-foreground">{formatRelative(c.getValue())}</span>,
    }),
  ]
  return (
    <DataTable
      caption={ta.alerts.pinsTitle}
      columns={columns}
      data={q.data?.items ?? EMPTY_STATIONS}
      getRowId={(s) => s.id}
      isLoading={q.isPending}
      error={q.error}
      onRetry={() => void q.refetch()}
      toolbar={toolbar}
      onRowClick={(s) => void navigate({ to: '/stations/$stationId', params: { stationId: s.id } })}
      empty={<EmptyState illustration={<AllClearIllustration />} title={ta.alerts.pinsEmpty} />}
    />
  )
}
