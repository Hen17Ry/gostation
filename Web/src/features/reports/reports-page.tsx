import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { Ban, Check, CircleSlash, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { dismissReport, reportsQuery, resolveReport, setReportingBan } from '@/api/admin'
import { type Report, reportReasons } from '@/api/admin-schemas'
import { counterKeys, reportKeys, stationKeys, userKeys } from '@/api/keys'
import { CursorPager } from '@/components/data/cursor-pager'
import { DataTable } from '@/components/data/data-table'
import { columnHelper } from '@/components/data/table-features'
import { DefinitionList } from '@/components/data/definition-list'
import { FilterSelect, ResetFilters, StatusTabs } from '@/components/data/filters'
import { PageHeader } from '@/components/data/page-header'
import { useCursorPages } from '@/components/data/use-cursor-pages'
import { ReasonDialog } from '@/components/dialogs/reason-dialog'
import { EmptyState } from '@/components/feedback/empty-state'
import { AllClearIllustration, EmptyListIllustration } from '@/components/feedback/illustrations'
import { DetailPanel, PanelSection } from '@/components/panel/detail-panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { ta } from '@/i18n/admin'
import { formatDateTime, formatRelative } from '@/lib/format'
import { type ReportSearch, toReportFilters } from './filters'

const route = getRouteApi('/_app/reports')

const STATUS_VARIANT = { open: 'warning', resolved: 'success', dismissed: 'secondary' } as const

export function ReportStatusBadge({ r }: { r: Report }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge variant={STATUS_VARIANT[r.status]}>{ta.reports.statuses[r.status]}</Badge>
      {r.abusive && <Badge variant="danger">{ta.reports.abusive}</Badge>}
    </span>
  )
}

const reporterName = (r: Report) =>
  r.reporter ? `${r.reporter.firstName} ${r.reporter.lastName}` : ta.reports.reporterDeleted

const col = columnHelper<Report>()
const columns = [
  col.accessor('reason', {
    header: ta.reports.columns.reason,
    meta: { hideable: false, className: 'min-w-48' },
    cell: ({ row }) => {
      const r = row.original
      return (
        <div className="flex flex-col">
          <button
            type="button"
            data-open-row
            className="w-fit cursor-pointer text-left font-medium underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ta.reports.reasons[r.reason]}
          </button>
          {(r.product || r.comment) && (
            <span className="line-clamp-1 max-w-72 text-2xs text-muted-foreground">
              {r.product?.label ?? r.comment}
            </span>
          )}
        </div>
      )
    },
  }),
  col.accessor((r) => r.station.name, {
    id: 'station',
    header: ta.reports.columns.station,
    cell: ({ row }) => (
      <Link
        to="/stations/$stationId"
        params={{ stationId: row.original.station.id }}
        className="text-sm underline-offset-4 hover:underline"
      >
        {row.original.station.name}
      </Link>
    ),
  }),
  col.accessor(reporterName, {
    id: 'reporter',
    header: ta.reports.columns.reporter,
    cell: ({ row }) => {
      const p = row.original.reporter
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className={p ? '' : 'text-muted-foreground italic'}>{reporterName(row.original)}</span>
          {p && p.abusiveReports > 0 && <Badge variant="warning">{ta.reports.reporterAbusive(p.abusiveReports)}</Badge>}
          {p?.reportingBanned && <Badge variant="danger">{ta.reports.reporterBanned}</Badge>}
        </span>
      )
    },
  }),
  col.accessor('createdAt', {
    header: ta.reports.columns.createdAt,
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
  col.accessor('status', {
    header: ta.reports.columns.status,
    cell: ({ row }) => <ReportStatusBadge r={row.original} />,
  }),
]

const EMPTY: Report[] = []

/** Remplace un signalement dans toutes les listes en cache, puis rafraîchit ce qui en dépend. */
function applyReport(qc: QueryClient, updated: Report) {
  qc.setQueriesData<{ items: Report[]; nextCursor: string | null }>({ queryKey: reportKeys.all }, (page) =>
    page ? { ...page, items: page.items.map((r) => (r.id === updated.id ? updated : r)) } : page,
  )
  void qc.invalidateQueries({ queryKey: reportKeys.all })
  void qc.invalidateQueries({ queryKey: counterKeys.all })
  void qc.invalidateQueries({ queryKey: stationKeys.detail(updated.station.id) })
  void qc.invalidateQueries({ queryKey: stationKeys.lists() })
}

export function ReportsPage({ search }: { search: ReportSearch }) {
  const navigate = route.useNavigate()
  const filters = toReportFilters(search)
  const q = useQuery(reportsQuery(filters))
  const { cursor: _c, ...rest } = filters
  const pages = useCursorPages(
    search.cursor,
    (cursor) => void navigate({ search: (prev) => ({ ...prev, cursor }) }),
    JSON.stringify(rest),
  )
  const update = (patch: Partial<ReportSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, cursor: undefined, report: undefined }), replace: true })
  const items = q.data?.items ?? EMPTY
  // Le signalement ouvert reste affiché après une décision, même s'il sort de la liste filtrée
  // (un signalement traité quitte « Ouverts ») : dernière version vue, remplacée par la réponse.
  const [kept, setKept] = useState<Report | undefined>(undefined)
  const found = search.report ? items.find((r) => r.id === search.report) : undefined
  if (found && found !== kept) setKept(found)
  const selected = search.report ? (found ?? (kept?.id === search.report ? kept : undefined)) : undefined
  const active = (search.reason ? 1 : 0) + (search.stationId ? 1 : 0)
  const stationName = search.stationId ? items[0]?.station.name : undefined

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={ta.reports.title} description={ta.reports.subtitle} />
      <DataTable
        caption={ta.reports.title}
        columns={columns}
        data={items}
        getRowId={(r) => r.id}
        storageKey="reports"
        isLoading={q.isPending}
        isFetching={q.isPlaceholderData}
        error={q.error}
        onRetry={() => void q.refetch()}
        selectedId={search.report}
        onRowClick={(r) => void navigate({ search: (prev) => ({ ...prev, report: r.id }) })}
        empty={
          filters.status === 'open' && active === 0 ? (
            <EmptyState
              illustration={<AllClearIllustration />}
              title={ta.reports.emptyOpen}
              description={ta.reports.emptyOpenBody}
            />
          ) : (
            <EmptyState
              illustration={<EmptyListIllustration />}
              title={active > 0 ? ta.common.emptyFiltered : ta.reports.empty}
              description={active > 0 ? ta.common.emptyFilteredBody : undefined}
            />
          )
        }
        toolbar={
          <>
            <StatusTabs
              label={ta.station.statusFilter}
              value={filters.status ?? 'open'}
              onChange={(status) => update({ status: status === 'open' ? undefined : status })}
              options={(['open', 'resolved', 'dismissed'] as const).map((s) => ({
                value: s,
                label: ta.reports.statusTabs[s]!,
              }))}
            />
            <FilterSelect
              label={ta.reports.reasonFilter}
              value={search.reason ?? 'all'}
              onChange={(v) => update({ reason: v === 'all' ? undefined : v })}
              options={[
                { value: 'all' as const, label: ta.common.all },
                ...reportReasons.map((r) => ({ value: r, label: ta.reports.reasons[r]! })),
              ]}
            />
            {search.stationId && (
              <Badge variant="brand" className="h-8 gap-1.5 rounded-full px-3 text-xs">
                {ta.reports.columns.station} : {stationName ?? '…'}
              </Badge>
            )}
            <ResetFilters count={active} onReset={() => update({ reason: undefined, stationId: undefined })} />
          </>
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
      <ReportPanel
        report={selected}
        onUpdated={setKept}
        onClose={() => void navigate({ search: (prev) => ({ ...prev, report: undefined }) })}
      />
    </div>
  )
}

type Action = 'resolve' | 'dismiss' | 'ban' | 'unban' | null

function ReportPanel({
  report: r,
  onClose,
  onUpdated,
}: {
  report?: Report
  onClose: () => void
  onUpdated: (r: Report) => void
}) {
  const qc = useQueryClient()
  const [action, setAction] = useState<Action>(null)
  const [abusive, setAbusive] = useState(false)
  const close = (o: boolean) => !o && setAction(null)
  if (!r) return null
  // Valeurs capturées (pas de `r!.x` dans les rappels : le React Compiler en ferait des
  // dépendances lues au rendu, nulles pour un auteur supprimé).
  const reportId = r.id
  const reporterId = r.reporter?.id

  async function decide(kind: 'resolve' | 'dismiss', note: string) {
    const updated =
      kind === 'resolve'
        ? await resolveReport(reportId, note || undefined)
        : await dismissReport(reportId, abusive, note || undefined)
    onUpdated(updated)
    applyReport(qc, updated)
    toast.success(kind === 'resolve' ? ta.reports.resolved : ta.reports.dismissed)
  }
  async function ban(banned: boolean, reason: string) {
    if (!reporterId) return
    await setReportingBan(reporterId, banned, reason)
    void qc.invalidateQueries({ queryKey: reportKeys.all })
    void qc.invalidateQueries({ queryKey: userKeys.all })
    toast.success(banned ? ta.reports.banned : ta.reports.unbanned)
  }

  return (
    <DetailPanel
      open
      onOpenChange={(o) => !o && onClose()}
      title={
        <>
          {ta.reports.reasons[r.reason]}
          {r.product && <span className="font-normal text-muted-foreground"> · {r.product.label}</span>}
        </>
      }
      description={`${ta.reports.panelTitle} · ${formatDateTime(r.createdAt)}`}
      badges={<ReportStatusBadge r={r} />}
      footer={
        r.status === 'open' && (
          <>
            <Button variant="outline" size="sm" onClick={() => setAction('dismiss')}>
              <CircleSlash aria-hidden />
              {ta.reports.dismiss}
            </Button>
            <Button size="sm" onClick={() => setAction('resolve')}>
              <Check aria-hidden />
              {ta.reports.resolve}
            </Button>
          </>
        )
      }
    >
      <PanelSection title={ta.reports.columns.station}>
        <Link
          to="/stations/$stationId"
          params={{ stationId: r.station.id }}
          className="w-fit text-sm font-medium text-brand-text underline-offset-4 hover:underline"
        >
          {r.station.name}
        </Link>
      </PanelSection>
      <PanelSection title={ta.reports.comment}>
        <p className="text-sm whitespace-pre-wrap">
          {r.comment ?? <span className="text-muted-foreground">{ta.reports.noComment}</span>}
        </p>
      </PanelSection>
      <PanelSection title={ta.reports.reporter}>
        {r.reporter ? (
          <div className="flex flex-col gap-3">
            <DefinitionList
              columns={1}
              items={[
                { label: ta.users.columns.name, value: `${r.reporter.firstName} ${r.reporter.lastName}` },
                { label: ta.users.columns.email, value: r.reporter.email },
                {
                  label: ta.users.fields.reports!,
                  value: (
                    <span className="inline-flex flex-wrap gap-1.5">
                      {r.reporter.abusiveReports > 0 ? (
                        <Badge variant="warning">{ta.reports.reporterAbusive(r.reporter.abusiveReports)}</Badge>
                      ) : (
                        ta.common.none
                      )}
                      {r.reporter.reportingBanned && <Badge variant="danger">{ta.reports.reporterBanned}</Badge>}
                    </span>
                  ),
                },
              ]}
            />
            {r.reporter.reportingBanned ? (
              <Button variant="outline" size="sm" className="self-start" onClick={() => setAction('unban')}>
                <ShieldCheck aria-hidden />
                {ta.reports.unban}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="self-start text-destructive hover:text-destructive"
                onClick={() => setAction('ban')}
              >
                <Ban aria-hidden />
                {ta.reports.ban}
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">{ta.reports.reporterDeleted}</p>
        )}
      </PanelSection>
      {r.status !== 'open' && (
        <PanelSection title={ta.reports.resolution}>
          <DefinitionList
            columns={1}
            items={[
              { label: ta.reports.columns.status, value: <ReportStatusBadge r={r} /> },
              r.resolvedAt && { label: ta.users.fields.createdAt!, value: formatDateTime(r.resolvedAt) },
              { label: ta.reports.resolutionNote, value: r.resolutionNote ?? ta.common.none },
            ]}
          />
        </PanelSection>
      )}

      <ReasonDialog
        open={action === 'resolve'}
        onOpenChange={close}
        title={ta.reports.resolveTitle}
        description={ta.reports.resolveBody}
        confirmLabel={ta.reports.resolve}
        reasonRequired={false}
        reasonLabel={ta.common.note}
        reasonHint={ta.common.noteHint}
        onConfirm={(note) => decide('resolve', note)}
      />
      <ReasonDialog
        open={action === 'dismiss'}
        onOpenChange={(o) => {
          if (!o) setAbusive(false)
          close(o)
        }}
        title={ta.reports.dismissTitle}
        description={ta.reports.dismissBody}
        confirmLabel={ta.reports.dismiss}
        reasonRequired={false}
        reasonLabel={ta.common.note}
        reasonHint={ta.common.noteHint}
        destructive={abusive}
        onConfirm={(note) => decide('dismiss', note)}
      >
        <div className="flex items-start gap-2">
          <Checkbox id="dismiss-abusive" checked={abusive} onCheckedChange={(v) => setAbusive(v === true)} />
          <Label htmlFor="dismiss-abusive" className="text-sm leading-snug font-normal">
            {ta.reports.dismissAbusive}
          </Label>
        </div>
      </ReasonDialog>
      <ReasonDialog
        open={action === 'ban'}
        onOpenChange={close}
        title={ta.reports.banTitle}
        description={ta.reports.banBody}
        confirmLabel={ta.reports.ban}
        reasonHint={ta.common.reasonInternalHint}
        destructive
        onConfirm={(reason) => ban(true, reason)}
      />
      <ReasonDialog
        open={action === 'unban'}
        onOpenChange={close}
        title={ta.reports.unbanTitle}
        description={ta.reports.unbanBody}
        confirmLabel={ta.reports.unban}
        reasonHint={ta.common.reasonInternalHint}
        onConfirm={(reason) => ban(false, reason)}
      />
    </DetailPanel>
  )
}
