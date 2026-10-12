import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { ArrowRight, Hexagon, MapPin } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'

import { type MapStatus, productsQuery, shortagesQuery, stationMapQuery, stationQuery } from '@/api/admin'
import type { ShortageMap, StationMap } from '@/api/admin-schemas'
import { DefinitionList } from '@/components/data/definition-list'
import { FilterChip, FilterSelect } from '@/components/data/filters'
import { PageHeader } from '@/components/data/page-header'
import { EmptyState } from '@/components/feedback/empty-state'
import { ErrorState } from '@/components/feedback/error-state'
import { NoShortageIllustration } from '@/components/feedback/illustrations'
import { CATEGORY_TOKENS, mapCategory, type MapCategory, RATE_STOPS } from '@/components/map/map-tokens'
import { DetailPanel, PanelSection } from '@/components/panel/detail-panel'
import { FreshnessBadge, StationStatusBadge } from '@/components/status/badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { t } from '@/i18n'
import { ta } from '@/i18n/admin'
import { freshnessOf } from '@/lib/freshness'
import { useNow } from '@/lib/use-now'
import { formatInteger, formatPercent, formatRange } from '@/lib/format'
import type { MapsSearch } from './search'

// MapLibre et les couches cartographiques : chargés à la demande, onglet par onglet.
const StationsMap = lazy(() => import('@/components/map/stations-map'))
const ShortagesHexMap = lazy(() => import('@/components/map/shortages-hex-map'))

const route = getRouteApi('/_app/maps')
const mapFallback = <Skeleton className="h-[min(70vh,640px)] w-full rounded-xl" />

export function MapsPage({ search }: { search: MapsSearch }) {
  const navigate = route.useNavigate()
  const tab = search.tab ?? 'stations'
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={ta.maps.title} description={ta.maps.subtitle} />
      <Tabs
        value={tab}
        onValueChange={(v) =>
          void navigate({ search: { tab: v === 'stations' ? undefined : (v as 'shortages') }, replace: true })
        }
      >
        <TabsList aria-label={ta.maps.title}>
          <TabsTrigger value="stations">
            <MapPin aria-hidden />
            {ta.maps.tabs.stations}
          </TabsTrigger>
          <TabsTrigger value="shortages">
            <Hexagon aria-hidden />
            {ta.maps.tabs.shortages}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="stations">{tab === 'stations' && <StationsTab search={search} />}</TabsContent>
        <TabsContent value="shortages">{tab === 'shortages' && <ShortagesTab search={search} />}</TabsContent>
      </Tabs>
    </div>
  )
}

// ── Stations ────────────────────────────────────────────────────────────────

const CATEGORIES: MapCategory[] = ['fresh', 'stale', 'expired', 'pending', 'suspended']

function filterMap(data: StationMap, reportedOnly: boolean): StationMap {
  return reportedOnly ? { ...data, features: data.features.filter((f) => f.properties.reported) } : data
}

function StationsTab({ search }: { search: MapsSearch }) {
  const navigate = route.useNavigate()
  const status = search.status ?? 'all'
  const q = useQuery(stationMapQuery(status))
  const update = (patch: Partial<MapsSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  const [filtered, setFiltered] = useState<{ src?: StationMap; reported?: boolean; out?: StationMap }>({})
  // Filtre client mémorisé : la carte n'est recréée que si les données ou le filtre changent.
  let data: StationMap | undefined
  if (q.data) {
    if (filtered.src === q.data && filtered.reported === !!search.reported) data = filtered.out
    else {
      data = filterMap(q.data, !!search.reported)
      setFiltered({ src: q.data, reported: !!search.reported, out: data })
    }
  }
  const counts = new Map<MapCategory, number>()
  data?.features.forEach((f) => {
    const c = mapCategory(f.properties)
    counts.set(c, (counts.get(c) ?? 0) + 1)
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={ta.common.filters}>
        <FilterSelect<MapStatus>
          label={ta.station.statusFilter}
          value={status}
          onChange={(v) => update({ status: v === 'all' ? undefined : v, station: undefined })}
          options={(['all', 'pending', 'approved', 'rejected', 'suspended'] as const).map((s) => ({
            value: s,
            label: ta.station.statusTabs[s]!,
          }))}
        />
        <FilterChip pressed={!!search.reported} onPressedChange={(on) => update({ reported: on || undefined })}>
          {ta.maps.reportedOnly}
        </FilterChip>
        {data && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {ta.maps.visible(data.features.length)}
          </span>
        )}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs" aria-label={ta.maps.legend}>
        {CATEGORIES.map((c) => (
          <li key={c} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-3 rounded-full ring-2 ring-card"
              style={{ background: `var(${CATEGORY_TOKENS[c][0]})` }}
            />
            {ta.maps.legendStatus[c]}
            <span className="text-muted-foreground tabular-nums">({formatInteger(counts.get(c) ?? 0)})</span>
          </li>
        ))}
      </ul>
      {q.isError && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} className="rounded-xl border bg-card" />
      ) : !data ? (
        mapFallback
      ) : (
        <Suspense fallback={mapFallback}>
          <StationsMap
            data={data}
            label={ta.maps.stationsLabel}
            selectedId={search.station}
            onSelect={(id) => update({ station: id })}
          />
        </Suspense>
      )}
      {search.station && <StationPanel id={search.station} onClose={() => update({ station: undefined })} />}
    </div>
  )
}

function StationPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery(stationQuery(id))
  const s = q.data
  const now = useNow()
  const fresh = freshnessOf(s?.lastStockUpdateAt, now)
  return (
    <DetailPanel
      open
      modal={false}
      onOpenChange={(o) => !o && onClose()}
      title={s?.name ?? ta.maps.stationPanel}
      description={s ? [s.address, s.city].filter(Boolean).join(' · ') : undefined}
      badges={
        s && (
          <>
            <StationStatusBadge status={s.status} />
            {s.status === 'approved' && <FreshnessBadge freshness={fresh} at={s.lastStockUpdateAt} />}
          </>
        )
      }
      footer={
        <Button asChild size="sm">
          <Link to="/stations/$stationId" params={{ stationId: id }}>
            {ta.maps.openStation}
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      }
    >
      {q.isPending ? (
        <div className="flex flex-col gap-3" aria-hidden>
          <Skeleton className="h-16" />
          <Skeleton className="h-32" />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} size="sm" />
      ) : (
        <>
          <PanelSection title={ta.station.sections.info}>
            <DefinitionList
              columns={1}
              items={[
                { label: ta.station.fields.ifu!, value: <span className="font-mono">{q.data.ifu}</span> },
                { label: ta.station.fields.phone!, value: q.data.phone },
                q.data.manager && {
                  label: ta.station.sections.manager,
                  value: `${q.data.manager.firstName} ${q.data.manager.lastName}`,
                },
              ]}
            />
          </PanelSection>
          <PanelSection title={ta.station.sections.stocks}>
            {q.data.stocks.length === 0 ? (
              <p className="text-sm text-muted-foreground">{ta.station.noStocks}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {q.data.stocks.map((st) => (
                  <li key={st.productId} className="flex items-center justify-between gap-2 text-sm">
                    <span>{st.label}</span>
                    <span className="flex items-center gap-2 tabular-nums">
                      {st.quantity === 0 ? (
                        <Badge variant="danger">{ta.station.outOfStock}</Badge>
                      ) : st.unit === 'cylinder' ? (
                        ta.station.units.cylinder(st.quantity)
                      ) : (
                        ta.station.units.liter(st.quantity)
                      )}
                      <FreshnessBadge freshness={st.freshness} at={st.freshAt} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </PanelSection>
        </>
      )}
    </DetailPanel>
  )
}

// ── Pénuries ────────────────────────────────────────────────────────────────

const PERIODS = ['24h', '7d', '30d'] as const

function ShortagesTab({ search }: { search: MapsSearch }) {
  const navigate = route.useNavigate()
  const period = search.period ?? '7d'
  const q = useQuery(shortagesQuery({ period, ...(search.productId ? { productId: search.productId } : {}) }))
  const products = useQuery(productsQuery)
  const update = (patch: Partial<MapsSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
  const data = q.data
  const cell = data && search.cell ? data.features.find((f) => f.id === search.cell) : undefined

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={ta.common.filters}>
        <ToggleGroup
          type="single"
          variant="segmented"
          spacing={0.5}
          value={period}
          onValueChange={(v) => v && update({ period: v === '7d' ? undefined : (v as '24h' | '30d'), cell: undefined })}
          aria-label={ta.maps.period}
        >
          {PERIODS.map((p) => (
            <ToggleGroupItem
              key={p}
              value={p}
              className="h-7 min-w-11 px-3 text-xs tabular-nums"
              aria-label={t.dashboard.periodLong[p]}
            >
              {t.dashboard.periods[p]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <FilterSelect
          label={ta.maps.product}
          value={search.productId ? String(search.productId) : 'all'}
          onChange={(v) => update({ productId: v === 'all' ? undefined : Number(v), cell: undefined })}
          options={[
            { value: 'all', label: ta.maps.allProducts },
            ...(products.data?.items ?? [])
              .filter((p) => p.active)
              .map((p) => ({ value: String(p.id), label: p.label })),
          ]}
        />
        {data && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatRange(data.period.from, data.period.to, data.period.timezone)}
          </span>
        )}
      </div>
      <RateLegend data={data} />
      {q.isError && !data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} className="rounded-xl border bg-card" />
      ) : !data ? (
        mapFallback
      ) : data.features.length === 0 ? (
        <EmptyState
          className="rounded-xl border bg-card"
          illustration={<NoShortageIllustration />}
          title={ta.maps.noCells}
          description={ta.maps.noCellsBody}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_20rem]">
          <Suspense fallback={mapFallback}>
            <ShortagesHexMap
              data={data}
              label={ta.maps.shortagesLabel}
              selected={search.cell ?? null}
              onSelect={(c) => update({ cell: c ?? undefined })}
            />
          </Suspense>
          <CellCard cell={cell} data={data} onSelect={(c) => update({ cell: c })} />
        </div>
      )}
    </div>
  )
}

function RateLegend({ data }: { data?: ShortageMap }) {
  const gradient = `linear-gradient(to right, ${RATE_STOPS.map(([v, token]) => `var(${token}) ${v * 100}%`).join(', ')})`
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground">{ta.maps.legendRate}</span>
        <div className="flex items-center gap-2">
          <span className="tabular-nums">0 %</span>
          <span aria-hidden className="h-2.5 w-40 rounded-full ring-1 ring-border" style={{ background: gradient }} />
          <span className="tabular-nums">100 %</span>
        </div>
      </div>
      {data && (
        <>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-3 rounded-xs border-2 border-foreground/70" />
            {ta.maps.legendShortage(formatPercent(data.threshold))}
          </span>
          {data.maskedCells > 0 && (
            <span className="text-muted-foreground">{ta.maps.masked(data.maskedCells, data.k)}</span>
          )}
        </>
      )}
    </div>
  )
}

/** Détail d'une cellule, et liste des cellules les plus touchées (alternative au clic sur la carte). */
function CellCard({
  cell,
  data,
  onSelect,
}: {
  cell?: ShortageMap['features'][number]
  data: ShortageMap
  onSelect: (cell: string) => void
}) {
  const top = [...data.features].sort((a, b) => b.properties.emptyRate - a.properties.emptyRate).slice(0, 8)
  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle>{cell ? ta.maps.cell : ta.maps.cells(data.features.length)}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {cell ? (
          <DefinitionList
            columns={1}
            items={[
              { label: ta.maps.cell, value: <span className="font-mono text-xs">{cell.properties.cell}</span> },
              { label: ta.maps.cellSearches, value: formatInteger(cell.properties.searches) },
              { label: ta.maps.cellEmpty, value: formatInteger(cell.properties.emptySearches) },
              { label: ta.maps.cellRate, value: formatPercent(cell.properties.emptyRate) },
              {
                label: ta.maps.cellShortage,
                value: (
                  <Badge variant={cell.properties.shortage ? 'danger' : 'success'}>
                    {cell.properties.shortage ? ta.maps.cellShortage : ta.maps.cellNoShortage}
                  </Badge>
                ),
              },
            ]}
          />
        ) : (
          <p className="text-xs text-muted-foreground">{ta.maps.selectCell}</p>
        )}
        <ol className="flex flex-col divide-y border-t pt-2">
          {top.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => onSelect(f.id)}
                aria-current={cell?.id === f.id ? 'true' : undefined}
                className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm py-1.5 text-left text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-[current=true]:font-semibold"
              >
                <span className="font-mono text-muted-foreground">{f.id}</span>
                <span className="flex items-center gap-2 tabular-nums">
                  {formatInteger(f.properties.searches)}
                  <Badge variant={f.properties.shortage ? 'danger' : 'secondary'}>
                    {formatPercent(f.properties.emptyRate)}
                  </Badge>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
