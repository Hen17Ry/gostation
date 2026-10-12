import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { Copy, ExternalLink, Map as MapIcon, RotateCw } from 'lucide-react'

import { countersQuery, stationsQuery } from '@/api/admin'
import type { StationSummary } from '@/api/admin-schemas'
import { CursorPager } from '@/components/data/cursor-pager'
import { DataTable } from '@/components/data/data-table'
import { columnHelper } from '@/components/data/table-features'
import { FilterChip, FilterSelect, ResetFilters, SearchInput, StatusTabs } from '@/components/data/filters'
import { PageHeader } from '@/components/data/page-header'
import { useCursorPages } from '@/components/data/use-cursor-pages'
import { EmptyState } from '@/components/feedback/empty-state'
import { AllClearIllustration, EmptyListIllustration } from '@/components/feedback/illustrations'
import { FlagBadge, FreshnessBadge, StationStatusBadge } from '@/components/status/badges'
import { Button } from '@/components/ui/button'
import { ta } from '@/i18n/admin'
import { copyText } from '@/lib/clipboard'
import { formatDate } from '@/lib/format'

import { activeStationFilters, STATION_FLAGS, type StationSearch, toStationFilters } from './search'

const route = getRouteApi('/_app/stations/')
const STATUS_TABS = ['pending', 'approved', 'rejected', 'suspended', 'all'] as const

const col = columnHelper<StationSummary>()
const columns = [
  col.accessor('name', {
    header: ta.station.columns.station,
    meta: { hideable: false, className: 'min-w-56' },
    cell: ({ row }) => {
      const s = row.original
      const sub = [s.brand, s.city].filter(Boolean).join(' · ')
      return (
        <div className="flex min-w-0 flex-col">
          <Link
            to="/stations/$stationId"
            params={{ stationId: s.id }}
            className="truncate font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
          >
            {s.name}
          </Link>
          {sub && <span className="truncate text-2xs text-muted-foreground">{sub}</span>}
        </div>
      )
    },
  }),
  col.accessor('ifu', {
    header: ta.station.columns.ifu,
    cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span>,
  }),
  col.accessor('status', {
    header: ta.station.columns.status,
    cell: (c) => <StationStatusBadge status={c.getValue()} />,
  }),
  col.accessor('freshness', {
    header: ta.station.columns.freshness,
    cell: ({ row }) =>
      row.original.status === 'approved' ? (
        <FreshnessBadge freshness={row.original.freshness} at={row.original.lastStockUpdateAt} />
      ) : (
        <span className="text-muted-foreground">{ta.common.none}</span>
      ),
  }),
  col.display({
    id: 'flags',
    header: ta.station.columns.flags,
    meta: { label: ta.station.columns.flags },
    cell: ({ row }) => <StationFlags s={row.original} />,
  }),
  col.accessor('createdAt', {
    header: ta.station.columns.createdAt,
    cell: (c) => <span className="text-xs whitespace-nowrap text-muted-foreground">{formatDate(c.getValue())}</span>,
  }),
]

function StationFlags({ s }: { s: StationSummary }) {
  const flags: Array<[string, 'warning' | 'danger' | 'info']> = []
  if (s.locationFlagged || s.hasPendingMove) flags.push(['needsReview', 'info'])
  if (s.excluded) flags.push(['excluded', 'danger'])
  else if (s.reported) flags.push(['reported', 'warning'])
  if (s.managerInactive) flags.push(['managerInactive', 'warning'])
  if (s.status === 'approved' && !s.hasOpeningHours) flags.push(['noHours', 'warning'])
  if (flags.length === 0) return <span className="text-muted-foreground">{ta.common.none}</span>
  return (
    <div className="flex flex-wrap gap-1">
      {flags.map(([k, variant]) => (
        <FlagBadge key={k} label={ta.station.flags[k]!} hint={ta.station.flagHints[k]} variant={variant} />
      ))}
    </div>
  )
}

const EMPTY: StationSummary[] = []

export function StationsPage({ search }: { search: StationSearch }) {
  const navigate = route.useNavigate()
  const filters = toStationFilters(search)
  const q = useQuery(stationsQuery(filters))
  const counters = useQuery(countersQuery)
  const { cursor: _cursor, ...rest } = filters
  const pages = useCursorPages(
    search.cursor,
    (cursor) => void navigate({ search: (prev) => ({ ...prev, cursor }) }),
    JSON.stringify(rest),
  )

  function update(patch: Partial<StationSearch>) {
    void navigate({ search: (prev) => ({ ...prev, ...patch, cursor: undefined }), replace: true })
  }

  const active = activeStationFilters(search)
  const items = q.data?.items ?? EMPTY
  const pendingTab = filters.status === 'pending' && active === 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={ta.station.title}
        description={ta.station.subtitle}
        actions={
          <Button variant="outline" size="sm" onClick={() => void q.refetch()} loading={q.isRefetching}>
            {!q.isRefetching && <RotateCw aria-hidden />}
            {ta.common.refresh}
          </Button>
        }
      />
      <DataTable
        caption={ta.station.title}
        columns={columns}
        data={items}
        getRowId={(s) => s.id}
        storageKey="stations"
        isLoading={q.isPending}
        isFetching={q.isPlaceholderData}
        error={q.error}
        onRetry={() => void q.refetch()}
        onRowClick={(s) => void navigate({ to: '/stations/$stationId', params: { stationId: s.id } })}
        rowLabel={(s) => s.name}
        rowActions={(s) => [
          {
            label: ta.common.openDetailShort,
            icon: ExternalLink,
            onSelect: () => void navigate({ to: '/stations/$stationId', params: { stationId: s.id } }),
          },
          ...(s.location
            ? [
                {
                  label: ta.common.showOnMap,
                  icon: MapIcon,
                  onSelect: () => void navigate({ to: '/maps', search: { station: s.id } }),
                },
              ]
            : []),
          { label: ta.common.copyIfu, icon: Copy, onSelect: () => void copyText(s.ifu) },
        ]}
        empty={
          pendingTab ? (
            <EmptyState
              illustration={<AllClearIllustration />}
              title={ta.station.emptyPending}
              description={ta.station.emptyPendingBody}
            />
          ) : (
            <EmptyState
              illustration={<EmptyListIllustration />}
              title={active > 0 ? ta.common.emptyFiltered : ta.station.empty}
              description={active > 0 ? ta.common.emptyFilteredBody : undefined}
              action={
                active > 0 && (
                  <Button variant="outline" size="sm" onClick={() => update(resetPatch)}>
                    {ta.common.resetFilters}
                  </Button>
                )
              }
            />
          )
        }
        toolbar={
          <>
            <StatusTabs
              label={ta.station.statusFilter}
              value={filters.status}
              onChange={(status) => update({ status: status === 'pending' ? undefined : status })}
              options={STATUS_TABS.map((s) => ({
                value: s,
                label: ta.station.statusTabs[s]!,
                count: s === 'pending' ? counters.data?.pendingStations : undefined,
              }))}
            />
            <SearchInput
              value={search.q ?? ''}
              onChange={(v) => update({ q: v || undefined })}
              placeholder={ta.station.searchPlaceholder}
              label={ta.station.searchLabel}
            />
            <FilterSelect
              label={ta.station.freshnessFilter}
              value={search.freshness ?? 'any'}
              onChange={(v) => update({ freshness: v === 'any' ? undefined : v })}
              options={[
                { value: 'any', label: ta.station.freshnessOptions.any },
                { value: 'stale', label: ta.station.freshnessOptions.stale },
                { value: 'expired', label: ta.station.freshnessOptions.expired },
              ]}
            />
            {STATION_FLAGS.map((k) => (
              <FilterChip
                key={k}
                pressed={!!search[k]}
                onPressedChange={(on) => update({ [k]: on || undefined })}
                hint={ta.station.flagHints[k]}
              >
                {ta.station.flags[k]}
              </FilterChip>
            ))}
            <ResetFilters count={active} onReset={() => update(resetPatch)} />
          </>
        }
        footer={
          <CursorPager
            page={pages.page}
            hasPrevious={pages.hasPrevious}
            nextCursor={q.data?.nextCursor}
            onPrevious={pages.previous}
            onNext={pages.next}
            summary={
              q.data
                ? `${ta.common.page(pages.page)} · ${ta.station.count(items.length, !!q.data.nextCursor)}`
                : undefined
            }
          />
        }
      />
    </div>
  )
}

const resetPatch: Partial<StationSearch> = {
  q: undefined,
  freshness: undefined,
  needsReview: undefined,
  reported: undefined,
  excluded: undefined,
  managerInactive: undefined,
  noHours: undefined,
}
