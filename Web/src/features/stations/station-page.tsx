import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, Ban, Check, FileText, MoreHorizontal, Pencil, PlayCircle, X } from 'lucide-react'
import { useState } from 'react'

import { decideStation, type StationDecision, stationQuery } from '@/api/admin'
import type { Station } from '@/api/admin-schemas'
import { isApiError } from '@/api/errors'
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog'
import { ReasonDialog } from '@/components/dialogs/reason-dialog'
import { ErrorState } from '@/components/feedback/error-state'
import { NotFoundIllustration } from '@/components/feedback/illustrations'
import { EmptyState } from '@/components/feedback/empty-state'
import { FlagBadge, FreshnessBadge, StationStatusBadge } from '@/components/status/badges'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { ta } from '@/i18n/admin'
import { freshnessOf } from '@/lib/freshness'
import { useNow } from '@/lib/use-now'
import { formatRelative } from '@/lib/format'

import { CorrectionDialog } from './correction-dialog'
import { DocumentViewer } from './document-viewer'
import { LocationCard, MoveRequestCard } from './location-card'
import { HoursCard, InfoCard, OpenReportsCard, StocksCard, TimelineCard } from './station-sections'
import { useStationWrite } from './use-station-write'

export function StationPage({ id }: { id: string }) {
  const q = useQuery(stationQuery(id))
  if (q.isPending) return <StationSkeleton />
  if (q.isError) {
    if (isApiError(q.error) && q.error.status === 404) {
      return (
        <EmptyState
          illustration={<NotFoundIllustration />}
          title={ta.station.empty}
          description={q.error.userMessage}
          headingLevel={1}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/stations">{ta.station.backToList}</Link>
            </Button>
          }
        />
      )
    }
    return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  }
  return <StationView s={q.data} />
}

function StationView({ s }: { s: Station }) {
  const now = useNow()
  const freshness = freshnessOf(s.lastStockUpdateAt, now)
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          to="/stations"
          className="inline-flex w-fit items-center gap-1.5 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {ta.station.backToList}
        </Link>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <StationStatusBadge status={s.status} />
              {s.status === 'approved' && <FreshnessBadge freshness={freshness} at={s.lastStockUpdateAt} />}
              {s.pendingMove && <FlagBadge label={ta.station.move.title} variant="info" />}
              {s.locationFlag && <FlagBadge label={ta.station.flags.needsReview!} variant="info" />}
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-balance">{s.name}</h1>
            <p className="text-xs text-muted-foreground">
              <span className="font-mono">IFU {s.ifu}</span>
              {s.city && <> · {s.city}</>}
              {s.brand && <> · {s.brand}</>}
              <> · {ta.common.since(formatRelative(s.statusChangedAt))}</>
            </p>
          </div>
          <StationActions s={s} />
        </header>
        {s.statusReason && (s.status === 'rejected' || s.status === 'suspended' || s.status === 'pending') && (
          <Alert variant={s.status === 'pending' ? 'info' : 'warning'}>
            <AlertTitle>{ta.station.fields.statusReason}</AlertTitle>
            <AlertDescription>{s.statusReason}</AlertDescription>
          </Alert>
        )}
      </div>

      {s.pendingMove && <MoveRequestCard s={s} />}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <InfoCard s={s} />
          <LocationCard s={s} />
          <div className="grid gap-6 xl:grid-cols-2">
            <HoursCard hours={s.openingHours} />
            <StocksCard stocks={s.stocks} lastUpdate={s.lastStockUpdateAt} />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <OpenReportsCard id={s.id} />
          <TimelineCard id={s.id} />
        </div>
      </div>
    </div>
  )
}

type Dialog = StationDecision | 'correct' | 'document' | null

/** Décisions possibles selon le statut (mêmes transitions que l'API). */
const DECISIONS: Record<Station['status'], StationDecision[]> = {
  pending: ['approve', 'reject'],
  approved: ['suspend'],
  rejected: [],
  suspended: ['unsuspend'],
}

const ICONS = { approve: Check, reject: X, suspend: Ban, unsuspend: PlayCircle }

function StationActions({ s }: { s: Station }) {
  const [dialog, setDialog] = useState<Dialog>(null)
  const { run } = useStationWrite(s.id)
  const decisions = DECISIONS[s.status]
  const close = (o: boolean) => !o && setDialog(null)

  return (
    <div className="flex flex-wrap items-center gap-2">
      {s.documentMime && (
        <Button variant="outline" size="sm" onClick={() => setDialog('document')}>
          <FileText aria-hidden />
          {ta.station.actions.document}
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={() => setDialog('correct')}>
        <Pencil aria-hidden />
        {ta.station.actions.correct}
      </Button>
      {decisions.map((d) => {
        const Icon = ICONS[d]
        const primary = d === 'approve' || d === 'unsuspend'
        return (
          <Button
            key={d}
            size="sm"
            variant={primary ? 'default' : d === 'reject' ? 'outline' : 'outline'}
            onClick={() => setDialog(d)}
            className={d === 'suspend' ? 'text-destructive hover:text-destructive' : undefined}
          >
            <Icon aria-hidden />
            {ta.station.actions[d]}
          </Button>
        )
      })}
      {s.status === 'approved' && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={ta.station.actions.more}>
              <MoreHorizontal aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link to="/maps" search={{ station: s.id }}>
                {ta.maps.tabs.stations}
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <ConfirmDialog
        open={dialog === 'approve'}
        onOpenChange={close}
        title={ta.station.decisions.approve!.title}
        description={ta.station.decisions.approve!.body}
        confirmLabel={ta.station.decisions.approve!.confirm}
        onConfirm={() =>
          run((cur) => decideStation(cur, 'approve'), ta.station.decisions.approve!.toast, ta.station.emailSent)
        }
      />
      {(['reject', 'suspend', 'unsuspend'] as const).map((d) => (
        <ReasonDialog
          key={d}
          open={dialog === d}
          onOpenChange={close}
          title={ta.station.decisions[d]!.title}
          description={ta.station.decisions[d]!.body}
          confirmLabel={ta.station.decisions[d]!.confirm}
          destructive={d !== 'unsuspend'}
          onConfirm={(reason) =>
            run((cur) => decideStation(cur, d, reason), ta.station.decisions[d]!.toast, ta.station.emailSent)
          }
        />
      ))}
      <CorrectionDialog open={dialog === 'correct'} onOpenChange={close} station={s} />
      <DocumentViewer
        open={dialog === 'document'}
        onOpenChange={close}
        stationId={s.id}
        stationName={s.name}
        ifu={s.ifu}
      />
    </div>
  )
}

function StationSkeleton() {
  return (
    <div className="flex flex-col gap-6" role="status" aria-label={ta.common.updating}>
      <Skeleton className="h-4 w-32" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    </div>
  )
}
