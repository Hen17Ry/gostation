import { useQuery } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { ArrowRight, Copy, ExternalLink } from 'lucide-react'

import { auditQuery, usersQuery } from '@/api/admin'
import type { AuditEntry } from '@/api/admin-schemas'
import { CursorPager } from '@/components/data/cursor-pager'
import { DataTable } from '@/components/data/data-table'
import { columnHelper } from '@/components/data/table-features'
import { DefinitionList } from '@/components/data/definition-list'
import { FilterSelect, ResetFilters, SearchInput } from '@/components/data/filters'
import { PageHeader } from '@/components/data/page-header'
import { useCursorPages } from '@/components/data/use-cursor-pages'
import { EmptyState } from '@/components/feedback/empty-state'
import { EmptyListIllustration } from '@/components/feedback/illustrations'
import { DetailPanel, PanelSection } from '@/components/panel/detail-panel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ta } from '@/i18n/admin'
import { copyText } from '@/lib/clipboard'
import { formatDateTime, formatRelative } from '@/lib/format'

import { actionLabel, actorName, auditChanges, auditDetails } from './describe'
import { type AuditSearch, toAuditFilters } from './filters'

const route = getRouteApi('/_app/audit')

const ACTION_GROUPS: Array<[string, (a: string) => boolean]> = [
  ['station', (a) => a.startsWith('admin.station') || a.startsWith('admin.location') || a === 'admin.document_viewed'],
  ['report', (a) => a.startsWith('admin.report') || a.startsWith('admin.reporting') || a === 'admin.alert_resolved'],
  ['user', (a) => a.startsWith('admin.user') || a === 'admin.verification_resent' || a.startsWith('user.')],
  ['catalog', (a) => a.startsWith('admin.product') || a.startsWith('admin.export')],
  ['manager', (a) => a.startsWith('manager.')],
  ['auth', (a) => a.startsWith('auth.') || a === 'admin.created' || a === 'admin.2fa_reset'],
]

const actionOptions = [
  { value: 'all', label: ta.audit.allActions },
  { value: 'admin.*', label: ta.audit.adminActions },
  ...ACTION_GROUPS.flatMap(([group, match]) =>
    Object.keys(ta.audit.actions)
      .filter(match)
      .map((a) => ({ value: a, label: `${ta.audit.groups[group]} · ${actionLabel(a)}` })),
  ),
]

const entityTypes = ['station', 'user', 'report', 'alert', 'product', 'export', 'session'] as const

/** Lien vers la cible quand elle a un écran (station, compte). */
function TargetLink({ e }: { e: AuditEntry }) {
  const type = ta.audit.entityTypes[e.entityType] ?? e.entityType
  if (e.entityType === 'station' && e.entityId)
    return (
      <Link to="/stations/$stationId" params={{ stationId: e.entityId }} className="underline-offset-4 hover:underline">
        {type}
      </Link>
    )
  if (e.entityType === 'user' && e.entityId)
    return (
      <Link to="/users" search={{ user: e.entityId }} className="underline-offset-4 hover:underline">
        {type}
      </Link>
    )
  return <span>{type}</span>
}

const col = columnHelper<AuditEntry>()
const columns = [
  col.accessor('createdAt', {
    header: ta.audit.columns.date,
    meta: { hideable: false },
    cell: (c) => (
      <button
        type="button"
        data-open-row
        className="cursor-pointer text-left text-xs whitespace-nowrap underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
        title={formatRelative(c.getValue())}
      >
        {formatDateTime(c.getValue())}
      </button>
    ),
  }),
  col.accessor('action', {
    header: ta.audit.columns.action,
    meta: { className: 'min-w-56' },
    cell: (c) => (
      <span className="flex flex-col">
        <span className="font-medium">{actionLabel(c.getValue())}</span>
        <span className="font-mono text-2xs text-muted-foreground">{c.getValue()}</span>
      </span>
    ),
  }),
  col.accessor(actorName, {
    id: 'actor',
    header: ta.audit.columns.actor,
    cell: ({ row, getValue }) => (
      <span className={row.original.actor ? '' : 'text-muted-foreground italic'}>
        {getValue()}
        {row.original.actor?.role && (
          <Badge variant="secondary" className="ml-1.5">
            {ta.users.roles[row.original.actor.role] ?? row.original.actor.role}
          </Badge>
        )}
      </span>
    ),
  }),
  col.accessor('entityType', {
    header: ta.audit.columns.target,
    cell: ({ row }) => (
      <span className="flex flex-col text-xs">
        <TargetLink e={row.original} />
        {row.original.entityId && (
          <span className="max-w-40 truncate font-mono text-2xs text-muted-foreground">{row.original.entityId}</span>
        )}
      </span>
    ),
  }),
]

const EMPTY: AuditEntry[] = []

export function AuditPage({ search }: { search: AuditSearch }) {
  const navigate = route.useNavigate()
  const filters = toAuditFilters(search)
  const q = useQuery(auditQuery(filters))
  const admins = useQuery({ ...usersQuery({ role: 'admin' }), staleTime: 5 * 60_000 })
  const { cursor: _c, ...rest } = filters
  const pages = useCursorPages(
    search.cursor,
    (cursor) => void navigate({ search: (prev) => ({ ...prev, cursor }) }),
    JSON.stringify(rest),
  )
  const update = (patch: Partial<AuditSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, cursor: undefined, entry: undefined }), replace: true })
  const active = Object.keys(rest).length
  const items = q.data?.items ?? EMPTY
  const selected = search.entry ? items.find((e) => e.id === search.entry) : undefined

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={ta.audit.title} description={ta.audit.subtitle} />
      <DataTable
        caption={ta.audit.title}
        columns={columns}
        data={items}
        getRowId={(e) => e.id}
        storageKey="audit"
        isLoading={q.isPending}
        isFetching={q.isPlaceholderData}
        error={q.error}
        onRetry={() => void q.refetch()}
        selectedId={search.entry}
        onRowClick={(e) => void navigate({ search: (prev) => ({ ...prev, entry: e.id }) })}
        rowLabel={(e) => actionLabel(e.action)}
        rowActions={(e) => [
          {
            label: ta.common.details,
            icon: ExternalLink,
            onSelect: () => void navigate({ search: (prev) => ({ ...prev, entry: e.id }) }),
          },
          ...(e.entityId ? [{ label: ta.audit.copyId, icon: Copy, onSelect: () => void copyText(e.entityId!) }] : []),
        ]}
        empty={
          <EmptyState
            illustration={<EmptyListIllustration />}
            title={active > 0 ? ta.common.emptyFiltered : ta.audit.empty}
            description={active > 0 ? ta.common.emptyFilteredBody : undefined}
          />
        }
        toolbar={
          <>
            <FilterSelect
              label={ta.audit.actor}
              value={search.actorId ?? 'all'}
              onChange={(v) => update({ actorId: v === 'all' ? undefined : v })}
              options={[
                { value: 'all', label: ta.audit.actorPlaceholder },
                ...(admins.data?.items ?? []).map((u) => ({ value: u.id, label: `${u.firstName} ${u.lastName}` })),
              ]}
            />
            <FilterSelect
              label={ta.audit.action}
              value={search.action ?? 'all'}
              onChange={(v) => update({ action: v === 'all' ? undefined : v })}
              options={actionOptions}
              className="max-w-80"
            />
            <FilterSelect
              label={ta.audit.target}
              value={search.entityType ?? 'all'}
              onChange={(v) => update({ entityType: v === 'all' ? undefined : v })}
              options={[
                { value: 'all', label: ta.audit.allTargets },
                ...entityTypes.map((e) => ({ value: e, label: ta.audit.entityTypes[e]! })),
              ]}
            />
            <SearchInput
              value={search.entityId ?? ''}
              onChange={(v) => update({ entityId: v || undefined })}
              placeholder={ta.audit.targetIdPlaceholder}
              label={ta.audit.targetId}
              className="sm:w-56"
            />
            <DateFilter
              label={ta.audit.from}
              value={search.from}
              max={search.to}
              onChange={(from) => update({ from })}
            />
            <DateFilter label={ta.audit.to} value={search.to} min={search.from} onChange={(to) => update({ to })} />
            <ResetFilters
              count={active}
              onReset={() =>
                update({
                  actorId: undefined,
                  action: undefined,
                  entityType: undefined,
                  entityId: undefined,
                  from: undefined,
                  to: undefined,
                })
              }
            />
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
      {selected && (
        <AuditPanel e={selected} onClose={() => void navigate({ search: (prev) => ({ ...prev, entry: undefined }) })} />
      )}
    </div>
  )
}

function DateFilter({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string
  value?: string
  onChange: (v: string | undefined) => void
  min?: string
  max?: string
}) {
  const id = `audit-date-${label}`
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="date"
        value={value ?? ''}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="h-8 w-36 text-xs"
      />
    </div>
  )
}

function AuditPanel({ e, onClose }: { e: AuditEntry; onClose: () => void }) {
  const changes = auditChanges(e)
  const details = auditDetails(e)
  return (
    <DetailPanel
      open
      onOpenChange={(o) => !o && onClose()}
      title={actionLabel(e.action)}
      description={formatDateTime(e.createdAt)}
      badges={
        <Badge variant="secondary" className="font-mono">
          {e.action}
        </Badge>
      }
    >
      <PanelSection title={ta.audit.panelTitle}>
        <DefinitionList
          columns={1}
          items={[
            { label: ta.audit.actor, value: actorName(e) + (e.actor?.email ? ` · ${e.actor.email}` : '') },
            {
              label: ta.audit.target,
              value: (
                <span className="flex flex-wrap items-center gap-2">
                  <TargetLink e={e} />
                  {e.entityId && (
                    <>
                      <span className="font-mono text-xs break-all">{e.entityId}</span>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={ta.audit.copyId}
                        onClick={() => void copyText(e.entityId!)}
                      >
                        <Copy />
                      </Button>
                    </>
                  )}
                </span>
              ),
            },
            e.requestId && {
              label: ta.common.requestId,
              value: <span className="font-mono text-xs">{e.requestId}</span>,
            },
          ]}
        />
        {e.entityType === 'station' && e.entityId && (
          <Button asChild size="sm" variant="outline" className="mt-2 self-start">
            <Link to="/stations/$stationId" params={{ stationId: e.entityId }}>
              {ta.audit.openTarget}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        )}
      </PanelSection>
      {changes.length > 0 && (
        <PanelSection title={ta.audit.changes}>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <caption className="sr-only">{ta.audit.changes}</caption>
              <thead className="bg-surface-sunken/60 text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2.5 py-1.5 text-left font-medium">
                    {ta.audit.field}
                  </th>
                  <th scope="col" className="px-2.5 py-1.5 text-left font-medium">
                    {ta.audit.before}
                  </th>
                  <th scope="col" className="px-2.5 py-1.5 text-left font-medium">
                    {ta.audit.after}
                  </th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c) => (
                  <tr key={c.field} className="border-t align-top">
                    <th scope="row" className="px-2.5 py-1.5 text-left font-medium">
                      {c.label}
                    </th>
                    <td className="px-2.5 py-1.5 break-words">
                      <del className="rounded-sm bg-danger-subtle px-1 text-danger-subtle-foreground decoration-1">
                        {c.from}
                      </del>
                    </td>
                    <td className="px-2.5 py-1.5 break-words">
                      <ins className="rounded-sm bg-success-subtle px-1 text-success-subtle-foreground no-underline">
                        {c.to}
                      </ins>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PanelSection>
      )}
      <PanelSection title={ta.audit.metadata}>
        {details.length === 0 ? (
          <p className="text-sm text-muted-foreground">{ta.audit.noMetadata}</p>
        ) : (
          <DefinitionList columns={1} items={details.map((d) => ({ label: d.label, value: d.value }))} />
        )}
      </PanelSection>
    </DetailPanel>
  )
}
