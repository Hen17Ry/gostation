import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi } from '@tanstack/react-router'
import { Download, FileJson, FileSpreadsheet, Loader2, Lock, Play } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { toast } from 'sonner'

import { createExport, downloadExport, exportsQuery, type NewExport, productsQuery } from '@/api/admin'
import { type Dataset, datasets, type Export } from '@/api/admin-schemas'
import { isApiError } from '@/api/errors'
import { exportKeys } from '@/api/keys'
import { CursorPager } from '@/components/data/cursor-pager'
import { DataTable } from '@/components/data/data-table'
import { columnHelper } from '@/components/data/table-features'
import { PageHeader } from '@/components/data/page-header'
import { useCursorPages } from '@/components/data/use-cursor-pages'
import { EmptyState } from '@/components/feedback/empty-state'
import { EmptyListIllustration } from '@/components/feedback/illustrations'
import { Field } from '@/components/form/field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ta } from '@/i18n/admin'
import { formatBytes, formatDate, formatDateTime, formatRelative, toLocalDate } from '@/lib/format'

const route = getRouteApi('/_app/exports')
const PERIOD_DATASETS: Dataset[] = ['search_stats', 'reports', 'audit']

const STATUS_VARIANT = { pending: 'info', ready: 'success', failed: 'danger', expired: 'secondary' } as const

function ExportStatus({ e }: { e: Export }) {
  return (
    <span className="flex flex-col gap-0.5">
      <Badge variant={STATUS_VARIANT[e.status]}>
        {e.status === 'pending' && <Loader2 className="animate-spin" aria-hidden />}
        {ta.exports.statuses[e.status]}
      </Badge>
      {e.error && <span className="text-2xs text-destructive">{ta.exports.errors[e.error]}</span>}
    </span>
  )
}

function DownloadButton({ e }: { e: Export }) {
  const [pending, setPending] = useState(false)
  if (e.status !== 'ready' || !e.download) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-sm"
          variant="outline"
          loading={pending}
          aria-label={`${ta.common.download} : ${ta.exports.datasets[e.dataset]} (${e.format.toUpperCase()})`}
          onClick={async () => {
            setPending(true)
            try {
              await downloadExport(e)
              toast.success(ta.exports.downloaded)
            } catch (err) {
              toast.error(ta.common.errorAction, { description: isApiError(err) ? err.userMessage : undefined })
            } finally {
              setPending(false)
            }
          }}
        >
          {!pending && <Download aria-hidden />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{ta.common.download}</TooltipContent>
    </Tooltip>
  )
}

const col = columnHelper<Export>()
const columns = [
  col.accessor('dataset', {
    header: ta.exports.columns.dataset,
    meta: { hideable: false },
    cell: ({ row }) => {
      const e = row.original
      const Icon = e.format === 'json' ? FileJson : FileSpreadsheet
      return (
        <span className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          <span className="flex flex-col">
            <span className="font-medium">{ta.exports.datasets[e.dataset]}</span>
            <span className="text-2xs text-muted-foreground uppercase">{e.format}</span>
          </span>
        </span>
      )
    },
  }),
  col.display({
    id: 'period',
    header: ta.exports.columns.period,
    meta: { label: ta.exports.columns.period },
    cell: ({ row }) => {
      const p = row.original.params
      return (
        <span className="text-xs whitespace-nowrap text-muted-foreground">
          {p.from && p.to ? `${formatDate(p.from)} → ${formatDate(p.to)}` : ta.exports.allTime}
        </span>
      )
    },
  }),
  col.accessor('status', { header: ta.exports.columns.status, cell: ({ row }) => <ExportStatus e={row.original} /> }),
  col.accessor('sizeBytes', {
    header: ta.exports.columns.size,
    cell: ({ row }) => {
      const e = row.original
      if (e.sizeBytes === null) return <span className="text-muted-foreground">{ta.common.none}</span>
      return (
        <span className="flex flex-col text-xs whitespace-nowrap tabular-nums">
          {formatBytes(e.sizeBytes)}
          {e.rowCount !== null && <span className="text-2xs text-muted-foreground">{ta.exports.rows(e.rowCount)}</span>}
        </span>
      )
    },
  }),
  col.accessor(
    (e) => (e.requestedBy ? `${e.requestedBy.firstName} ${e.requestedBy.lastName}` : ta.audit.deletedActor),
    {
      id: 'requestedBy',
      header: ta.exports.columns.requestedBy,
      cell: (c) => <span className="text-xs">{c.getValue()}</span>,
    },
  ),
  col.accessor('createdAt', {
    header: ta.exports.columns.createdAt,
    cell: ({ row }) => {
      const e = row.original
      return (
        <span className="flex flex-col text-xs whitespace-nowrap">
          <time dateTime={e.createdAt} title={formatDateTime(e.createdAt)}>
            {formatRelative(e.createdAt)}
          </time>
          {e.expiresAt && e.status === 'ready' && (
            <span className="text-2xs text-muted-foreground">{ta.exports.expiresIn(formatRelative(e.expiresAt))}</span>
          )}
        </span>
      )
    },
  }),
  col.display({
    id: 'download',
    header: () => <span className="sr-only">{ta.common.download}</span>,
    meta: { hideable: false, className: 'text-right' },
    cell: ({ row }) => <DownloadButton e={row.original} />,
  }),
]

const EMPTY: Export[] = []

export function ExportsPage({ cursor }: { cursor?: string }) {
  const navigate = route.useNavigate()
  const q = useQuery(exportsQuery(cursor))
  const pages = useCursorPages(cursor, (c) => void navigate({ search: { cursor: c } }), 'exports')
  const polling = q.data?.items.some((e) => e.status === 'pending') ?? false
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={ta.exports.title} description={ta.exports.subtitle} />
      <div className="grid items-start gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <NewExportCard />
        <DataTable
          caption={ta.exports.title}
          columns={columns}
          data={q.data?.items ?? EMPTY}
          getRowId={(e) => e.id}
          storageKey="exports"
          isLoading={q.isPending}
          isFetching={q.isPlaceholderData}
          error={q.error}
          onRetry={() => void q.refetch()}
          toolbar={
            polling && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                <span className="size-2 animate-pulse rounded-full bg-info motion-reduce:animate-none" aria-hidden />
                {ta.exports.polling}
              </span>
            )
          }
          empty={
            <EmptyState
              illustration={<EmptyListIllustration />}
              title={ta.exports.empty}
              description={ta.exports.emptyBody}
            />
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
      </div>
    </div>
  )
}

function NewExportCard() {
  const qc = useQueryClient()
  const formId = useId()
  const products = useQuery(productsQuery)
  const today = toLocalDate(new Date())
  const [dataset, setDataset] = useState<Dataset>('stations')
  const [format, setFormat] = useState<Export['format']>('csv')
  const [from, setFrom] = useState(() => toLocalDate(new Date(Date.now() - 29 * 86_400_000)))
  const [to, setTo] = useState(today)
  const [productId, setProductId] = useState('all')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const withPeriod = PERIOD_DATASETS.includes(dataset)
  const rangeInvalid = withPeriod && (!from || !to || from > to)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (rangeInvalid) return
    const body: NewExport = { dataset, format }
    if (withPeriod) Object.assign(body, { from, to })
    if (dataset === 'search_stats' && productId !== 'all') body.productId = Number(productId)
    setPending(true)
    setError(null)
    try {
      await createExport(body)
      void qc.invalidateQueries({ queryKey: exportKeys.all })
      toast.success(ta.exports.requested, { description: ta.exports.requestedBody })
    } catch (err) {
      setError(err)
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ta.exports.newTitle}</CardTitle>
        <CardDescription className="flex items-start gap-1.5">
          <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {ta.exports.privacy}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field label={ta.exports.dataset} hint={ta.exports.datasetHints[dataset]}>
            {(p) => (
              <Select value={dataset} onValueChange={(v) => setDataset(v as Dataset)}>
                <SelectTrigger id={p.id} aria-describedby={p['aria-describedby']} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {datasets.map((d) => (
                    <SelectItem key={d} value={d}>
                      {ta.exports.datasets[d]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span id={`${formId}-format`} className="text-sm font-medium">
              {ta.exports.format}
            </span>
            <ToggleGroup
              type="single"
              variant="segmented"
              spacing={0.5}
              value={format}
              onValueChange={(v) => v && setFormat(v as Export['format'])}
              aria-labelledby={`${formId}-format`}
            >
              <ToggleGroupItem value="csv" className="h-7 px-4 text-xs">
                CSV
              </ToggleGroupItem>
              <ToggleGroupItem value="json" className="h-7 px-4 text-xs">
                JSON
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          {withPeriod && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={ta.exports.from} error={rangeInvalid ? ta.exports.invalidRange : undefined}>
                {(p) => (
                  <Input {...p} type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} />
                )}
              </Field>
              <Field label={ta.exports.to}>
                {(p) => (
                  <Input {...p} type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
                )}
              </Field>
              <p className="col-span-2 -mt-2 text-2xs text-muted-foreground">{ta.exports.periodHint}</p>
            </div>
          )}
          {dataset === 'search_stats' && (
            <Field label={ta.exports.product}>
              {(p) => (
                <Select value={productId} onValueChange={setProductId}>
                  <SelectTrigger id={p.id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{ta.exports.allProducts}</SelectItem>
                    {(products.data?.items ?? []).map((pr) => (
                      <SelectItem key={pr.id} value={String(pr.id)}>
                        {pr.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
          )}
          {error !== null && (
            <Alert variant="destructive">
              <AlertDescription>{isApiError(error) ? error.userMessage : ta.common.errorAction}</AlertDescription>
            </Alert>
          )}
          <Button type="submit" loading={pending} className="self-start">
            {!pending && <Play aria-hidden />}
            {ta.exports.submit}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
