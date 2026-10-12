import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, Link } from '@tanstack/react-router'
import { Ban, Copy, ExternalLink, MailCheck, MailWarning, Send, ShieldCheck, UserCheck, UserX } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { setReportingBan, type UserAction, userAction, userQuery, usersQuery } from '@/api/admin'
import type { User, UserSummary } from '@/api/admin-schemas'
import { counterKeys, reportKeys, userKeys } from '@/api/keys'
import { CursorPager } from '@/components/data/cursor-pager'
import { DataTable } from '@/components/data/data-table'
import { columnHelper } from '@/components/data/table-features'
import { DefinitionList } from '@/components/data/definition-list'
import { FilterSelect, ResetFilters, SearchInput } from '@/components/data/filters'
import { PageHeader } from '@/components/data/page-header'
import { useCursorPages } from '@/components/data/use-cursor-pages'
import { ReasonDialog } from '@/components/dialogs/reason-dialog'
import { EmptyState } from '@/components/feedback/empty-state'
import { ErrorState } from '@/components/feedback/error-state'
import { EmptyListIllustration } from '@/components/feedback/illustrations'
import { DetailPanel, PanelSection } from '@/components/panel/detail-panel'
import { StationStatusBadge } from '@/components/status/badges'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ta } from '@/i18n/admin'
import { copyText } from '@/lib/clipboard'
import { formatDate, formatDateTime, formatRelative } from '@/lib/format'
import { type UserSearch, toUserFilters } from './filters'

const route = getRouteApi('/_app/users')

const STATUS_VARIANT = { active: 'success', disabled: 'danger', pending_deletion: 'warning' } as const

function UserStatusBadge({ status }: { status: UserSummary['status'] }) {
  return <Badge variant={STATUS_VARIANT[status]}>{ta.users.statuses[status]}</Badge>
}

function VerifiedBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <Badge variant="success">
      <MailCheck aria-hidden />
      {ta.users.verified}
    </Badge>
  ) : (
    <Badge variant="warning">
      <MailWarning aria-hidden />
      {ta.users.notVerified}
    </Badge>
  )
}

const col = columnHelper<UserSummary>()
const columns = [
  col.accessor((u) => `${u.firstName} ${u.lastName}`, {
    id: 'name',
    header: ta.users.columns.name,
    meta: { hideable: false, className: 'min-w-44' },
    cell: ({ row, getValue }) => (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          data-open-row
          className="cursor-pointer text-left font-medium underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
        >
          {getValue()}
        </button>
        {row.original.reportingBanned && <Badge variant="danger">{ta.users.reportingBanned}</Badge>}
      </span>
    ),
  }),
  col.accessor('email', {
    header: ta.users.columns.email,
    cell: (c) => <span className="text-xs">{c.getValue()}</span>,
  }),
  col.accessor('role', {
    header: ta.users.columns.role,
    cell: (c) => (
      <Badge variant={c.getValue() === 'admin' ? 'brand' : 'secondary'}>{ta.users.roles[c.getValue()]}</Badge>
    ),
  }),
  col.accessor('status', { header: ta.users.columns.status, cell: (c) => <UserStatusBadge status={c.getValue()} /> }),
  col.accessor('emailVerified', {
    header: ta.users.columns.verified,
    cell: (c) => <VerifiedBadge verified={c.getValue()} />,
  }),
  col.accessor('lastLoginAt', {
    header: ta.users.columns.lastLogin,
    cell: (c) => {
      const v = c.getValue()
      return (
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          {v ? formatRelative(v) : ta.common.never}
        </span>
      )
    },
  }),
  col.accessor('createdAt', {
    header: ta.users.columns.createdAt,
    cell: (c) => <span className="text-xs whitespace-nowrap text-muted-foreground">{formatDate(c.getValue())}</span>,
  }),
]

const EMPTY: UserSummary[] = []

export function UsersPage({ search }: { search: UserSearch }) {
  const navigate = route.useNavigate()
  const filters = toUserFilters(search)
  const q = useQuery(usersQuery(filters))
  const { cursor: _c, ...rest } = filters
  const pages = useCursorPages(
    search.cursor,
    (cursor) => void navigate({ search: (prev) => ({ ...prev, cursor }) }),
    JSON.stringify(rest),
  )
  const update = (patch: Partial<UserSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, cursor: undefined }), replace: true })
  const active = Object.keys(rest).length
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={ta.users.title} description={ta.users.subtitle} />
      <DataTable
        caption={ta.users.title}
        columns={columns}
        data={q.data?.items ?? EMPTY}
        getRowId={(u) => u.id}
        storageKey="users"
        isLoading={q.isPending}
        isFetching={q.isPlaceholderData}
        error={q.error}
        onRetry={() => void q.refetch()}
        selectedId={search.user}
        onRowClick={(u) => void navigate({ search: (prev) => ({ ...prev, user: u.id }) })}
        rowLabel={(u) => `${u.firstName} ${u.lastName}`}
        rowActions={(u) => [
          {
            label: ta.common.openDetailShort,
            icon: ExternalLink,
            onSelect: () => void navigate({ search: (prev) => ({ ...prev, user: u.id }) }),
          },
          { label: ta.common.copyEmail, icon: Copy, onSelect: () => void copyText(u.email) },
        ]}
        empty={
          <EmptyState
            illustration={<EmptyListIllustration />}
            title={active > 0 ? ta.common.emptyFiltered : ta.users.empty}
            description={active > 0 ? ta.common.emptyFilteredBody : undefined}
          />
        }
        toolbar={
          <>
            <SearchInput
              value={search.q ?? ''}
              onChange={(v) => update({ q: v || undefined })}
              placeholder={ta.users.searchPlaceholder}
              label={ta.users.searchLabel}
            />
            <FilterSelect
              label={ta.users.roleFilter}
              value={search.role ?? 'all'}
              onChange={(v) => update({ role: v === 'all' ? undefined : v })}
              options={[
                { value: 'all' as const, label: ta.common.all },
                ...(['user', 'manager', 'admin'] as const).map((r) => ({ value: r, label: ta.users.rolesPlural[r]! })),
              ]}
            />
            <FilterSelect
              label={ta.users.statusFilter}
              value={search.status ?? 'all'}
              onChange={(v) => update({ status: v === 'all' ? undefined : v })}
              options={[
                { value: 'all' as const, label: ta.common.all },
                ...(['active', 'disabled', 'pending_deletion'] as const).map((s) => ({
                  value: s,
                  label: ta.users.statuses[s]!,
                })),
              ]}
            />
            <FilterSelect
              label={ta.users.verifiedFilter}
              value={search.verified ?? 'all'}
              onChange={(v) => update({ verified: v === 'all' ? undefined : v })}
              options={[
                { value: 'all' as const, label: ta.common.any },
                { value: 'yes' as const, label: ta.users.verified },
                { value: 'no' as const, label: ta.users.notVerified },
              ]}
            />
            <ResetFilters
              count={active}
              onReset={() => update({ q: undefined, role: undefined, status: undefined, verified: undefined })}
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
      {search.user && (
        <UserPanel
          id={search.user}
          onClose={() => void navigate({ search: (prev) => ({ ...prev, user: undefined }) })}
        />
      )}
    </div>
  )
}

type Action = UserAction | 'ban' | 'unban' | null

const ACTION_TEXT = {
  disable: {
    title: ta.users.disableTitle,
    body: ta.users.disableBody,
    confirm: ta.users.disable,
    toast: ta.users.disabled,
  },
  reactivate: {
    title: ta.users.reactivateTitle,
    body: ta.users.reactivateBody,
    confirm: ta.users.reactivate,
    toast: ta.users.reactivated,
  },
  resend: { title: ta.users.resendTitle, body: ta.users.resendBody, confirm: ta.users.resend, toast: ta.users.resent },
  ban: { title: ta.reports.banTitle, body: ta.reports.banBody, confirm: ta.reports.ban, toast: ta.reports.banned },
  unban: {
    title: ta.reports.unbanTitle,
    body: ta.reports.unbanBody,
    confirm: ta.reports.unban,
    toast: ta.reports.unbanned,
  },
}

function UserPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const qc = useQueryClient()
  const q = useQuery(userQuery(id))
  const [action, setAction] = useState<Action>(null)
  const u = q.data

  async function act(a: Exclude<Action, null>, reason: string) {
    if (a === 'ban' || a === 'unban') await setReportingBan(id, a === 'ban', reason)
    else {
      const updated = await userAction(id, a, reason)
      if (updated) qc.setQueryData(userQuery(id).queryKey, updated)
    }
    void qc.invalidateQueries({ queryKey: userKeys.all })
    void qc.invalidateQueries({ queryKey: reportKeys.all })
    void qc.invalidateQueries({ queryKey: counterKeys.all })
    toast.success(ACTION_TEXT[a].toast)
  }

  const f = ta.users.fields
  return (
    <DetailPanel
      open
      onOpenChange={(o) => !o && onClose()}
      title={u ? `${u.firstName} ${u.lastName}` : ta.users.panelTitle}
      description={u?.email}
      badges={
        u && (
          <>
            <Badge variant={u.role === 'admin' ? 'brand' : 'secondary'}>{ta.users.roles[u.role]}</Badge>
            <UserStatusBadge status={u.status} />
            <VerifiedBadge verified={u.emailVerified} />
          </>
        )
      }
      actions={u && <UserActions u={u} onAction={setAction} />}
    >
      {q.isPending ? (
        <div className="flex flex-col gap-3" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} size="sm" />
      ) : (
        <>
          <PanelSection title={ta.users.panelTitle}>
            <DefinitionList
              items={[
                { label: f.createdAt!, value: formatDateTime(q.data.createdAt) },
                {
                  label: f.lastLogin!,
                  value: q.data.lastLoginAt ? formatDateTime(q.data.lastLoginAt) : ta.common.never,
                },
                {
                  label: f.emailVerifiedAt!,
                  value: q.data.emailVerifiedAt ? formatDateTime(q.data.emailVerifiedAt) : ta.common.none,
                },
                { label: f.twoFactor!, value: q.data.twoFactorEnabled ? ta.users.enabled : ta.users.disabledLabel },
                { label: f.sessions!, value: q.data.activeSessions },
                { label: f.devices!, value: q.data.devices },
                { label: f.reports!, value: ta.users.reportsCount(q.data.reports.total, q.data.reports.abusive) },
                { label: f.favorites!, value: q.data.favorites },
                {
                  label: f.privacy!,
                  value: ta.users.privacy(q.data.privacyPolicyVersion, formatDate(q.data.privacyAcceptedAt)),
                  wide: true,
                },
                q.data.passwordChangedAt && {
                  label: f.passwordChanged!,
                  value: formatDateTime(q.data.passwordChangedAt),
                },
                q.data.deletionRequestedAt && { label: f.deletion!, value: formatDateTime(q.data.deletionRequestedAt) },
              ]}
            />
          </PanelSection>
          {(q.data.disabledReason || q.data.reportingBanReason) && (
            <PanelSection title={ta.common.reason}>
              <DefinitionList
                columns={1}
                items={[
                  q.data.disabledReason && { label: f.disabledReason!, value: q.data.disabledReason },
                  q.data.reportingBanReason && { label: f.banReason!, value: q.data.reportingBanReason },
                ]}
              />
            </PanelSection>
          )}
          {q.data.station && (
            <PanelSection title={f.station!}>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  to="/stations/$stationId"
                  params={{ stationId: q.data.station.id }}
                  className="text-sm font-medium text-brand-text underline-offset-4 hover:underline"
                >
                  {q.data.station.name}
                </Link>
                <StationStatusBadge status={q.data.station.status} />
              </div>
            </PanelSection>
          )}
          {q.data.role === 'admin' && <p className="mt-4 text-xs text-muted-foreground">{ta.users.adminProtected}</p>}
        </>
      )}
      {action && (
        <ReasonDialog
          open
          onOpenChange={(o) => !o && setAction(null)}
          title={ACTION_TEXT[action].title}
          description={ACTION_TEXT[action].body}
          confirmLabel={ACTION_TEXT[action].confirm}
          destructive={action === 'disable' || action === 'ban'}
          reasonHint={
            action === 'ban' || action === 'unban' ? ta.common.reasonInternalHint : ta.common.reasonInternalHint
          }
          onConfirm={(reason) => act(action, reason)}
        />
      )}
    </DetailPanel>
  )
}

function UserActions({ u, onAction }: { u: User; onAction: (a: Exclude<Action, null>) => void }) {
  if (u.role === 'admin') return null
  return (
    <>
      {u.status === 'active' ? (
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:text-destructive"
          onClick={() => onAction('disable')}
        >
          <UserX aria-hidden />
          {ta.users.disable}
        </Button>
      ) : u.status === 'disabled' ? (
        <Button size="sm" variant="outline" onClick={() => onAction('reactivate')}>
          <UserCheck aria-hidden />
          {ta.users.reactivate}
        </Button>
      ) : null}
      {u.status === 'active' && !u.emailVerified && (
        <Button size="sm" variant="outline" onClick={() => onAction('resend')}>
          <Send aria-hidden />
          {ta.users.resend}
        </Button>
      )}
      {u.reportingBannedAt ? (
        <Button size="sm" variant="outline" onClick={() => onAction('unban')}>
          <ShieldCheck aria-hidden />
          {ta.reports.unban}
        </Button>
      ) : (
        u.role === 'user' && (
          <Button size="sm" variant="ghost" onClick={() => onAction('ban')}>
            <Ban aria-hidden />
            {ta.reports.ban}
          </Button>
        )
      )}
    </>
  )
}
