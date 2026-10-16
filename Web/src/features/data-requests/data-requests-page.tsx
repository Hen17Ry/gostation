import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { Check, FileDown, Mail, Play, Plus, RotateCw, Trash2, X } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { toast } from 'sonner'

import {
  closeDataRequest,
  dataRequestQuery,
  dataRequestsQuery,
  deleteDataRequestAccount,
  exportDataRequest,
  recordDataRequest,
  resendDataRequestCode,
  startDataRequest,
  verifyDataRequest,
} from '@/api/admin'
import {
  type DataRequest,
  type DataRequestItem,
  type DataRequestType,
  dataRequestTypes,
  type DataRequestUser,
} from '@/api/admin-schemas'
import { isApiError } from '@/api/errors'
import { counterKeys, dataRequestKeys } from '@/api/keys'
import { CursorPager } from '@/components/data/cursor-pager'
import { DataTable } from '@/components/data/data-table'
import { DefinitionList } from '@/components/data/definition-list'
import { FilterChip, FilterSelect, ResetFilters, StatusTabs } from '@/components/data/filters'
import { PageHeader } from '@/components/data/page-header'
import { columnHelper } from '@/components/data/table-features'
import { useCursorPages } from '@/components/data/use-cursor-pages'
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog'
import { ReasonDialog } from '@/components/dialogs/reason-dialog'
import { EmptyState } from '@/components/feedback/empty-state'
import { AllClearIllustration, EmptyListIllustration } from '@/components/feedback/illustrations'
import { Field } from '@/components/form/field'
import { DetailPanel, PanelSection } from '@/components/panel/detail-panel'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ta } from '@/i18n/admin'
import { formatDate, formatDateTime, formatRelative } from '@/lib/format'
import { useNow } from '@/lib/use-now'
import { daysLeft } from './deadline'
import { DataRequestsDueAlert } from './deadline-alert'
import { type DataRequestSearch, toDataRequestFilters } from './filters'

const route = getRouteApi('/_app/data-requests')
const tr = ta.dataRequests

const STATUS_VARIANT = { pending: 'warning', in_progress: 'info', completed: 'success', rejected: 'secondary' } as const
const RESPONSE_MAX = 2000

type Summary = Pick<DataRequestItem, 'status' | 'overdue' | 'dueSoon'> & { verified: boolean }

/** Statut, retard ou échéance proche, et identité à confirmer : jamais la couleur seule. */
export function DataRequestBadges({ r }: { r: Summary }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge variant={STATUS_VARIANT[r.status]}>{tr.statuses[r.status]}</Badge>
      {r.overdue && <Badge variant="danger">{tr.overdue}</Badge>}
      {r.dueSoon && <Badge variant="warning">{tr.dueSoon}</Badge>}
      {!r.verified && (r.status === 'pending' || r.status === 'in_progress') && (
        <Badge variant="outline">{tr.unverified}</Badge>
      )}
    </span>
  )
}

function Deadline({ dueAt, open, now }: { dueAt: string; open: boolean; now: number }) {
  const d = daysLeft(dueAt, now)
  return (
    <span className="flex flex-col">
      <time className="text-sm whitespace-nowrap tabular-nums" dateTime={dueAt} title={formatDateTime(dueAt)}>
        {formatDate(dueAt)}
      </time>
      {open && (
        <span className={d < 0 ? 'text-2xs font-medium text-destructive' : 'text-2xs text-muted-foreground'}>
          {d < 0 ? tr.daysLate(-d) : tr.daysLeft(d)}
        </span>
      )}
    </span>
  )
}

const personLabel = (u: DataRequestUser | null) =>
  !u ? tr.noAccount : u.deleted ? tr.deletedAccount : (u.email ?? tr.noAccount)

const isOpen = (status: DataRequestItem['status']) => status === 'pending' || status === 'in_progress'

const col = columnHelper<DataRequestItem>()

function useColumns(now: number) {
  return [
    col.accessor('type', {
      header: tr.columns.type,
      meta: { hideable: false, className: 'min-w-44' },
      cell: ({ row }) => (
        <div className="flex flex-col">
          <button
            type="button"
            data-open-row
            className="w-fit cursor-pointer text-left font-medium underline-offset-4 outline-none hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring"
          >
            {tr.types[row.original.type]}
          </button>
          <span className="font-mono text-2xs text-muted-foreground">{row.original.reference}</span>
        </div>
      ),
    }),
    col.accessor((r) => personLabel(r.user), {
      id: 'person',
      header: tr.columns.person,
      cell: ({ row }) => {
        const u = row.original.user
        return (
          <span className="flex flex-col">
            <span className={!u || u.deleted ? 'text-muted-foreground italic' : 'break-all'}>{personLabel(u)}</span>
            {u?.role && !u.deleted && <span className="text-2xs text-muted-foreground">{tr.roles[u.role]}</span>}
          </span>
        )
      },
    }),
    col.accessor('source', {
      header: tr.columns.source,
      cell: (c) => <span className="text-sm">{tr.sources[c.getValue()]}</span>,
    }),
    col.accessor('dueAt', {
      header: tr.columns.dueAt,
      cell: ({ row }) => <Deadline dueAt={row.original.dueAt} open={isOpen(row.original.status)} now={now} />,
    }),
    col.accessor('createdAt', {
      header: tr.columns.createdAt,
      cell: (c) => (
        <time
          className="text-xs whitespace-nowrap text-muted-foreground"
          dateTime={c.getValue()}
          title={formatDateTime(c.getValue())}
        >
          {formatRelative(c.getValue(), now)}
        </time>
      ),
    }),
    col.accessor('status', {
      header: tr.columns.status,
      cell: ({ row }) => <DataRequestBadges r={row.original} />,
    }),
  ]
}

const EMPTY: DataRequestItem[] = []

export function DataRequestsPage({ search }: { search: DataRequestSearch }) {
  const navigate = route.useNavigate()
  const now = useNow()
  const columns = useColumns(now)
  const filters = toDataRequestFilters(search)
  const q = useQuery(dataRequestsQuery(filters))
  const { cursor: _c, ...rest } = filters
  const pages = useCursorPages(
    search.cursor,
    (cursor) => void navigate({ search: (prev) => ({ ...prev, cursor }) }),
    JSON.stringify(rest),
  )
  const update = (patch: Partial<DataRequestSearch>) =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, cursor: undefined, request: undefined }), replace: true })
  const [recording, setRecording] = useState(false)
  const items = q.data?.items ?? EMPTY
  const listed = search.request ? items.find((r) => r.id === search.request) : undefined
  const active = (search.type ? 1 : 0) + (search.overdue ? 1 : 0)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tr.title}
        description={tr.subtitle}
        actions={
          <Button size="sm" onClick={() => setRecording(true)}>
            <Plus aria-hidden />
            {tr.record}
          </Button>
        }
      />
      <DataRequestsDueAlert link={false} />
      <DataTable
        caption={tr.title}
        columns={columns}
        data={items}
        getRowId={(r) => r.id}
        storageKey="data-requests"
        isLoading={q.isPending}
        isFetching={q.isPlaceholderData}
        error={q.error}
        onRetry={() => void q.refetch()}
        selectedId={search.request}
        onRowClick={(r) => void navigate({ search: (prev) => ({ ...prev, request: r.id }) })}
        empty={
          filters.status === 'open' && active === 0 ? (
            <EmptyState illustration={<AllClearIllustration />} title={tr.emptyOpen} description={tr.emptyOpenBody} />
          ) : (
            <EmptyState
              illustration={<EmptyListIllustration />}
              title={active > 0 ? ta.common.emptyFiltered : tr.empty}
              description={active > 0 ? ta.common.emptyFilteredBody : undefined}
            />
          )
        }
        toolbar={
          <>
            <StatusTabs
              label={ta.station.statusFilter}
              value={filters.status === 'pending' || filters.status === 'in_progress' ? 'open' : filters.status}
              onChange={(status) => update({ status: status === 'open' ? undefined : status })}
              options={(['open', 'completed', 'rejected', 'all'] as const).map((s) => ({
                value: s,
                label: tr.statusTabs[s]!,
              }))}
            />
            <FilterSelect
              label={tr.typeFilter}
              value={search.type ?? 'all'}
              onChange={(v) => update({ type: v === 'all' ? undefined : v })}
              options={[
                { value: 'all' as const, label: ta.common.all },
                ...dataRequestTypes.map((v) => ({ value: v, label: tr.types[v]! })),
              ]}
            />
            <FilterChip
              pressed={search.overdue === true}
              onPressedChange={(p) => update({ overdue: p ? true : undefined })}
              hint={tr.overdueOnlyHint}
            >
              {tr.overdueOnly}
            </FilterChip>
            <ResetFilters count={active} onReset={() => update({ type: undefined, overdue: undefined })} />
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
      {search.request && (
        <RequestPanel
          key={search.request}
          id={search.request}
          listed={listed}
          now={now}
          onClose={() => void navigate({ search: (prev) => ({ ...prev, request: undefined }) })}
        />
      )}
      <RecordDialog
        open={recording}
        onOpenChange={setRecording}
        onRecorded={(r) => void navigate({ search: { request: r.id } })}
      />
    </div>
  )
}

/**
 * Écriture sur une demande (If-Match) : la fiche est remplacée par la réponse, listes et compteurs
 * rafraîchis. Sur 412, la fiche est rechargée et l'erreur remonte au dialogue, qui garde la saisie.
 */
function useRequestWrite(id: string) {
  const qc = useQueryClient()
  return async function run(write: (r: DataRequest) => Promise<DataRequest>, success: string, description?: string) {
    const current = qc.getQueryData(dataRequestQuery(id).queryKey)
    if (!current) throw new Error('data request not loaded')
    try {
      const updated = await write(current)
      qc.setQueryData(dataRequestQuery(id).queryKey, updated)
      void qc.invalidateQueries({ queryKey: dataRequestKeys.lists() })
      void qc.invalidateQueries({ queryKey: counterKeys.all })
      toast.success(success, description ? { description } : undefined)
      return updated
    } catch (e) {
      if (isApiError(e) && (e.status === 412 || e.code === 'resource.version_conflict')) {
        await qc.invalidateQueries({ queryKey: dataRequestQuery(id).queryKey })
        toast.warning(tr.conflict.title, { description: tr.conflict.body })
      }
      throw e
    }
  }
}

type Action = 'start' | 'export' | 'delete' | 'close' | 'reject' | null

function RequestPanel({
  id,
  listed,
  now,
  onClose,
}: {
  id: string
  listed?: DataRequestItem
  now: number
  onClose: () => void
}) {
  const q = useQuery(dataRequestQuery(id))
  const run = useRequestWrite(id)
  const [action, setAction] = useState<Action>(null)
  const close = (o: boolean) => !o && setAction(null)
  const r = q.data
  const head = r ?? listed

  return (
    <DetailPanel
      open
      onOpenChange={(o) => !o && onClose()}
      title={head ? tr.types[head.type] : tr.title}
      description={
        head
          ? `${tr.panelTitle(head.reference)} · ${tr.receivedOn(formatDate(head.createdAt), tr.sources[head.source]!)}`
          : undefined
      }
      badges={r && <DataRequestBadges r={{ ...r, verified: r.verifiedAt !== null }} />}
      footer={
        r?.actions.close && (
          <>
            <Button variant="outline" size="sm" onClick={() => setAction('reject')}>
              <X aria-hidden />
              {tr.reject}
            </Button>
            {r.status === 'pending' && r.verifiedAt && (
              <Button variant="outline" size="sm" onClick={() => setAction('start')}>
                <Play aria-hidden />
                {tr.start}
              </Button>
            )}
            {r.actions.export && (r.type === 'access' || r.type === 'export') && (
              <Button variant="outline" size="sm" onClick={() => setAction('export')}>
                <FileDown aria-hidden />
                {tr.export}
              </Button>
            )}
            {r.actions.deleteAccount && (
              <Button variant="destructive" size="sm" onClick={() => setAction('delete')}>
                <Trash2 aria-hidden />
                {tr.deleteAccount}
              </Button>
            )}
            <Button size="sm" onClick={() => setAction('close')}>
              <Check aria-hidden />
              {tr.close}
            </Button>
          </>
        )
      }
    >
      {q.isError ? (
        <Alert variant="destructive">
          <AlertDescription>{isApiError(q.error) ? q.error.userMessage : ta.common.errorAction}</AlertDescription>
        </Alert>
      ) : !r ? (
        <div className="flex flex-col gap-3" aria-busy>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <>
          <PanelSection title={tr.sections.deadline}>
            <DefinitionList
              columns={1}
              items={[
                {
                  label: tr.columns.dueAt,
                  value: (
                    <span className="inline-flex flex-wrap items-center gap-2">
                      <span>{tr.dueOn(formatDate(r.dueAt))}</span>
                      {isOpen(r.status) && (
                        <span className={r.overdue ? 'font-medium text-destructive' : 'text-muted-foreground'}>
                          (
                          {daysLeft(r.dueAt, now) < 0
                            ? tr.daysLate(-daysLeft(r.dueAt, now))
                            : tr.daysLeft(daysLeft(r.dueAt, now))}
                          )
                        </span>
                      )}
                    </span>
                  ),
                },
                r.completedAt && { label: tr.statuses[r.status]!, value: tr.closedOn(formatDateTime(r.completedAt)) },
                r.handledBy && { label: tr.handledBy, value: r.handledBy },
              ]}
            />
          </PanelSection>
          <PanelSection title={tr.sections.person}>
            {r.user && !r.user.deleted ? (
              <DefinitionList
                columns={1}
                items={[
                  { label: ta.users.columns.name, value: `${r.user.firstName ?? ''} ${r.user.lastName ?? ''}`.trim() },
                  { label: ta.users.columns.email, value: <span className="break-all">{r.user.email}</span> },
                  r.user.role && { label: ta.users.columns.role, value: tr.roles[r.user.role] },
                ]}
              />
            ) : (
              <p className="text-sm text-muted-foreground italic">{personLabel(r.user)}</p>
            )}
          </PanelSection>
          <PanelSection title={tr.sections.request}>
            <p className="text-sm whitespace-pre-wrap">
              {r.details ?? <span className="text-muted-foreground">{tr.noDetails}</span>}
            </p>
            <p className="text-2xs text-muted-foreground">{tr.typeHints[r.type]}</p>
          </PanelSection>
          <PanelSection title={tr.sections.identity}>
            <Identity r={r} run={run} />
          </PanelSection>
          {r.response && (
            <PanelSection title={tr.sections.answer}>
              <p className="text-sm whitespace-pre-wrap">{r.response}</p>
            </PanelSection>
          )}

          <ConfirmDialog
            open={action === 'start'}
            onOpenChange={close}
            title={tr.start}
            description={tr.panelTitle(r.reference)}
            confirmLabel={tr.start}
            onConfirm={() => run(startDataRequest, tr.started)}
          />
          <ConfirmDialog
            open={action === 'export'}
            onOpenChange={close}
            title={tr.exportTitle}
            description={tr.exportBody}
            confirmLabel={tr.export}
            onConfirm={() => run(exportDataRequest, tr.exported, tr.exportedBody)}
          />
          <ReasonDialog
            open={action === 'delete'}
            onOpenChange={close}
            title={tr.deleteTitle}
            description={tr.deleteBody}
            confirmLabel={tr.deleteAccount}
            reasonRequired={false}
            reasonLabel={tr.deleteResponse}
            reasonHint={tr.deleteResponseHint}
            maxLength={RESPONSE_MAX}
            destructive
            onConfirm={(response) => run((cur) => deleteDataRequestAccount(cur, response), tr.deleted, tr.deletedBody)}
          />
          <ReasonDialog
            open={action === 'close'}
            onOpenChange={close}
            title={tr.closeTitle}
            description={tr.closeBody}
            confirmLabel={tr.close}
            reasonLabel={tr.response}
            reasonHint={tr.responseHint}
            maxLength={RESPONSE_MAX}
            onConfirm={(response) => run((cur) => closeDataRequest(cur, 'completed', response), tr.closed)}
          />
          <ReasonDialog
            open={action === 'reject'}
            onOpenChange={close}
            title={tr.rejectTitle}
            description={tr.rejectBody}
            confirmLabel={tr.reject}
            reasonLabel={tr.rejectReason}
            maxLength={RESPONSE_MAX}
            destructive
            onConfirm={(response) => run((cur) => closeDataRequest(cur, 'rejected', response), tr.rejected)}
          />
        </>
      )}
    </DetailPanel>
  )
}

/**
 * Vérification d'identité : une demande de l'app est authentifiée ; une demande reçue par email
 * n'est traitée qu'après saisie du code envoyé à l'adresse du compte.
 */
function Identity({ r, run }: { r: DataRequest; run: ReturnType<typeof useRequestWrite> }) {
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [touched, setTouched] = useState(false)
  const [pending, setPending] = useState<'verify' | 'resend' | null>(null)
  const [error, setError] = useState<unknown>(null)
  const requestId = r.id
  const invalid = !/^\d{6}$/.test(code)

  if (r.source === 'app') return <p className="text-sm">{tr.identityApp}</p>
  if (r.verifiedAt) return <p className="text-sm">{tr.identityConfirmed(formatDateTime(r.verifiedAt))}</p>
  if (!r.actions.verify) return <p className="text-sm text-muted-foreground">{tr.unverified}</p>

  async function verify(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (invalid) return
    setPending('verify')
    setError(null)
    try {
      await run((cur) => verifyDataRequest(cur, code), tr.verifiedToast, tr.verifiedToastBody)
      setCode('')
      setTouched(false)
    } catch (err) {
      setError(err)
    } finally {
      setPending(null)
    }
  }
  async function resend() {
    setPending('resend')
    setError(null)
    try {
      const updated = await resendDataRequestCode(requestId)
      qc.setQueryData(dataRequestQuery(requestId).queryKey, updated)
      toast.success(tr.codeSent)
    } catch (err) {
      setError(err)
    } finally {
      setPending(null)
    }
  }

  const apiError = error !== null ? (isApiError(error) ? error.userMessage : ta.common.errorAction) : undefined
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-pretty">{r.codePending ? tr.identityPending : tr.identityNoCode}</p>
      {r.codePending && (
        <form onSubmit={verify} noValidate className="flex flex-wrap items-end gap-2">
          <Field
            label={tr.code}
            hint={tr.codeHint}
            error={touched && invalid ? tr.codeInvalid : apiError}
            className="w-44"
          >
            {(p) => (
              <Input
                {...p}
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                className="font-mono tracking-widest tabular-nums"
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            )}
          </Field>
          <Button type="submit" size="sm" loading={pending === 'verify'} disabled={pending !== null} className="mb-5">
            <Check aria-hidden />
            {tr.verify}
          </Button>
        </form>
      )}
      {!r.codePending && apiError && (
        <p role="alert" className="text-2xs font-medium text-destructive">
          {apiError}
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        loading={pending === 'resend'}
        disabled={pending !== null}
        onClick={() => void resend()}
      >
        <RotateCw aria-hidden />
        {tr.resendCode}
      </Button>
    </div>
  )
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function RecordDialog({
  open,
  onOpenChange,
  onRecorded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onRecorded: (r: DataRequest) => void
}) {
  const qc = useQueryClient()
  const formId = useId()
  const [email, setEmail] = useState('')
  const [type, setType] = useState<DataRequestType>('access')
  const [details, setDetails] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const emailInvalid = !EMAIL.test(email.trim())
  const notFound = isApiError(error) && error.code === 'data_request.account_not_found'

  function reset(o: boolean) {
    if (pending) return
    if (!o) {
      setEmail('')
      setType('access')
      setDetails('')
      setSubmitted(false)
      setError(null)
    }
    onOpenChange(o)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (emailInvalid) return
    setPending(true)
    setError(null)
    try {
      const r = await recordDataRequest({ email: email.trim(), type, details: details.trim() || undefined })
      qc.setQueryData(dataRequestQuery(r.id).queryKey, r)
      void qc.invalidateQueries({ queryKey: dataRequestKeys.lists() })
      void qc.invalidateQueries({ queryKey: counterKeys.all })
      toast.success(tr.recorded, { description: tr.recordedBody })
      setPending(false)
      reset(false)
      onRecorded(r)
    } catch (err) {
      setPending(false)
      setError(err)
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{tr.recordTitle}</DialogTitle>
          <DialogDescription>{tr.recordBody}</DialogDescription>
        </DialogHeader>
        <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field
            label={tr.email}
            error={
              submitted && emailInvalid
                ? tr.emailInvalid
                : notFound && isApiError(error)
                  ? error.userMessage
                  : undefined
            }
          >
            {(p) => (
              <Input
                {...p}
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            )}
          </Field>
          <Field label={tr.type} hint={tr.typeHints[type]}>
            {(p) => (
              <Select value={type} onValueChange={(v) => setType(v as DataRequestType)}>
                <SelectTrigger id={p.id} aria-describedby={p['aria-describedby']} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dataRequestTypes.map((k) => (
                    <SelectItem key={k} value={k}>
                      {tr.types[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field
            label={`${tr.details} (facultatif)`}
            hint={tr.detailsHint}
            labelAction={
              <span className="text-2xs text-muted-foreground tabular-nums" aria-hidden>
                {ta.common.reasonCounter(details.length, RESPONSE_MAX)}
              </span>
            }
          >
            {(p) => (
              <Textarea
                {...p}
                value={details}
                maxLength={RESPONSE_MAX}
                rows={3}
                onChange={(e) => setDetails(e.target.value)}
              />
            )}
          </Field>
          {error !== null && !notFound && (
            <Alert variant="destructive">
              <AlertDescription>{isApiError(error) ? error.userMessage : ta.common.errorAction}</AlertDescription>
            </Alert>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => reset(false)} disabled={pending}>
            {ta.common.cancel}
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            <Mail aria-hidden />
            {tr.recordSubmit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
