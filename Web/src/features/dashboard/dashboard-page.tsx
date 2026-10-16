import { useQuery } from '@tanstack/react-query'
import { Flag, MapPinOff, Search, Store, UserPlus } from 'lucide-react'
import { type ReactNode, startTransition, useDeferredValue, useEffect, useRef, useState } from 'react'

import { ApiError } from '@/api/errors'
import { dashboardQuery } from '@/api/queries'
import type { Dashboard } from '@/api/schemas'
import { ErrorState } from '@/components/feedback/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { t } from '@/i18n'
import { formatInteger, formatPercent, formatRange } from '@/lib/format'
import { cn } from '@/lib/utils'

import { KpiCard, KpiCardSkeleton } from './kpi-card'
import { isPartialBucket, type PeriodSearch } from './period'
import { PeriodPicker } from './period-picker'
import { ShortagesCard } from './shortages-card'
import { DataRequestsDueAlert } from '@/features/data-requests/deadline-alert'
import { Shortcuts } from './shortcuts'
import { StationsCard } from './stations-card'

export function DashboardPage({ period }: { period: PeriodSearch }) {
  const q = useQuery(dashboardQuery(period))
  // Rendu du contenu en priorité différée : React 19 le découpe en tranches et rend la main au
  // navigateur entre deux (pas de tâche longue), le squelette reste affiché d'ici là.
  const d = useDeferredValue(q.data, undefined)
  return (
    <div className="@container flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl font-semibold tracking-tight">{t.dashboard.title}</h1>
          <p className="text-xs text-muted-foreground tabular-nums">
            {t.dashboard.periodLong[period.period]}
            {d && <> · {formatRange(d.period.from, d.period.to, d.period.timezone)}</>}
          </p>
        </div>
        <PeriodPicker value={period} />
      </header>

      {q.isError && !q.data ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} className="rounded-xl border bg-card" />
      ) : !d ? (
        <DashboardSkeleton />
      ) : (
        <div
          aria-busy={q.isFetching}
          className={cn('transition-opacity duration-(--duration-base)', q.isPlaceholderData && 'opacity-60')}
        >
          <DashboardContent data={d} />
        </div>
      )}
    </div>
  )
}

// Graphiques (Recharts) dans un chunk à part, chargé dès l'arrivée sur la page : le premier
// rendu n'attend pas leur JS, et chaque graphique est monté dans sa propre étape (pas de Suspense
// qui les ferait apparaître ensemble dans un seul commit).
type Charts = {
  SearchesChart: typeof import('./searches-chart').SearchesChart
  FreshnessCard: typeof import('./freshness-card').FreshnessCard
}
const loadCharts = () =>
  Promise.all([import('./searches-chart'), import('./freshness-card')]).then(([a, b]): Charts => ({
    SearchesChart: a.SearchesChart,
    FreshnessCard: b.FreshnessCard,
  }))

const KPI_SPAN = ['@3xl:col-span-2 @5xl:col-span-1', '@3xl:col-span-3 @5xl:col-span-1'] as const
const kpiSpan = (i: number) => (i < 3 ? KPI_SPAN[0] : KPI_SPAN[1])

/** Apparition en fondu décalé (keyframes CSS sur transform et opacité, coupées si mouvement réduit). */
function Reveal({ i, children, className }: { i: number; children: ReactNode; className?: string }) {
  return (
    <div className={cn('animate-step-in', className)} style={{ animationDelay: `${i * 50}ms` }}>
      {children}
    </div>
  )
}

/**
 * Montage par étapes : une section par tâche (indicateurs, recherches, fraîcheur, pénuries), pour
 * qu'aucun commit ne bloque le fil principal longtemps. Chaque section attend à la place d'un
 * squelette de même hauteur (pas de décalage de mise en page).
 */
function useStages(total: number, ready: (next: number) => boolean) {
  const [stage, setStage] = useState(1)
  const canAdvance = stage < total && ready(stage + 1)
  useEffect(() => {
    if (!canAdvance) return
    const id = window.setTimeout(() => startTransition(() => setStage((s) => s + 1)), 0)
    return () => window.clearTimeout(id)
  }, [stage, canAdvance])
  return stage
}

/** Vrai dès que l'élément approche de la fenêtre (une seule fois). */
function useNearViewport<T extends Element>(margin = '200px') {
  const ref = useRef<T>(null)
  // Sans IntersectionObserver (environnement de test), tout est chargé tout de suite.
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), {
      rootMargin: margin,
    })
    io.observe(el)
    return () => io.disconnect()
  }, [near, margin])
  return [ref, near] as const
}

function DashboardContent({ data: d }: { data: Dashboard }) {
  const [charts, setCharts] = useState<Charts | null>(null)
  const [chartsError, setChartsError] = useState<unknown>(null)
  const [attempt, setAttempt] = useState(0)
  // Graphiques (Recharts) chargés quand leur section approche de l'écran : sur un téléphone, ils
  // sont sous les indicateurs et n'alourdissent pas l'arrivée sur la page.
  const [chartsRef, chartsNear] = useNearViewport<HTMLDivElement>()
  useEffect(() => {
    if (!chartsNear) return
    let alive = true
    loadCharts().then(
      (c) => alive && setCharts(c),
      (e: unknown) => alive && setChartsError(ApiError.network(e)),
    )
    return () => {
      alive = false
    }
  }, [attempt, chartsNear])
  // Étapes : indicateurs, puis pénuries et statuts ; chaque graphique, une fois son module chargé,
  // est monté dans sa propre étape (jamais deux graphiques dans le même commit).
  const stage = useStages(2, () => true)
  const chartStage = useStages(3, (next) => next === 2 || charts !== null)
  const retryCharts = () => {
    setChartsError(null)
    setAttempt((a) => a + 1)
  }
  // Sparklines sans la tranche en cours : sa chute apparente n'est qu'une journée incomplète.
  const all = d.series.searches
  const last = all.at(-1)
  const searches = last && isPartialBucket(last.at, d.period.granularity, d.period.to) ? all.slice(0, -1) : all
  return (
    <div className="flex flex-col gap-6">
      <Reveal i={0}>
        <section
          aria-label="Indicateurs"
          className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @3xl:grid-cols-6 @5xl:grid-cols-5"
        >
          <KpiCard
            className={kpiSpan(0)}
            label={t.dashboard.kpi.searches}
            kpi={d.searches.total}
            format={formatInteger}
            icon={<Search />}
            trend={searches.map((s) => s.searches)}
          />
          <KpiCard
            className={kpiSpan(1)}
            label={t.dashboard.kpi.emptyRate}
            hint={t.dashboard.kpi.emptyRateHint}
            kpi={d.searches.emptyRate}
            format={formatPercent}
            good="down"
            icon={<MapPinOff />}
            trend={searches.map((s) => (s.searches ? s.emptySearches / s.searches : 0))}
          />
          <KpiCard
            className={kpiSpan(2)}
            label={t.dashboard.kpi.users}
            kpi={d.registrations.users}
            format={formatInteger}
            icon={<UserPlus />}
          />
          <KpiCard
            className={kpiSpan(3)}
            label={t.dashboard.kpi.managers}
            kpi={d.registrations.managers}
            format={formatInteger}
            icon={<Store />}
          />
          <KpiCard
            className={cn(kpiSpan(4), '@xl:@max-3xl:col-span-2')}
            label={t.dashboard.kpi.reports}
            kpi={d.reports.created}
            format={formatInteger}
            good="down"
            icon={<Flag />}
          />
        </section>
      </Reveal>
      <Reveal i={1}>
        <div className="flex flex-col gap-3">
          <DataRequestsDueAlert />
          <Shortcuts data={d} />
        </div>
      </Reveal>
      {/* Conteneur observé (une boîte réelle : un élément en display: contents n'intersecte jamais). */}
      <div ref={chartsRef}>
        <Reveal i={2} className="grid gap-4 @5xl:grid-cols-3">
          {chartsError ? (
            <ErrorState
              error={chartsError}
              onRetry={retryCharts}
              className="rounded-xl border bg-card @5xl:col-span-3"
            />
          ) : (
            <>
              {charts && chartStage >= 2 ? (
                <charts.SearchesChart data={d} className="@5xl:col-span-2" />
              ) : (
                <Skeleton className="h-[392px] rounded-xl @5xl:col-span-2" />
              )}
              {charts && chartStage >= 3 ? (
                <charts.FreshnessCard data={d} />
              ) : (
                <Skeleton className="h-[392px] rounded-xl" />
              )}
            </>
          )}
        </Reveal>
      </div>
      <Reveal i={3} className="grid items-start gap-4 @5xl:grid-cols-3">
        {stage >= 2 ? (
          <>
            <ShortagesCard data={d} className="@5xl:col-span-2" />
            <StationsCard data={d} />
          </>
        ) : (
          <>
            <Skeleton className="h-[420px] rounded-xl @5xl:col-span-2" />
            <Skeleton className="h-[300px] rounded-xl" />
          </>
        )}
      </Reveal>
    </div>
  )
}

/** Squelettes aux dimensions du contenu final (aucun décalage de mise en page). */
function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label={t.app.loading}>
      <div className="grid grid-cols-1 gap-3 @xl:grid-cols-2 @3xl:grid-cols-6 @5xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <KpiCardSkeleton key={i} className={kpiSpan(i)} />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-20" />
        <div className="grid gap-3 @xl:grid-cols-2 @5xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[74px] rounded-xl" />
          ))}
        </div>
      </div>
      <div className="grid gap-4 @5xl:grid-cols-3">
        <Skeleton className="h-[356px] rounded-xl @5xl:col-span-2" />
        <Skeleton className="h-[356px] rounded-xl" />
      </div>
      <div className="grid gap-4 @5xl:grid-cols-3">
        <Skeleton className="h-[420px] rounded-xl @5xl:col-span-2" />
        <Skeleton className="h-[420px] rounded-xl" />
      </div>
    </div>
  )
}
