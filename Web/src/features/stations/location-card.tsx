import { ArrowRight, Check, MapPinned, Smartphone, X } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'

import { decideMove, dismissLocationFlag } from '@/api/admin'
import type { Station } from '@/api/admin-schemas'
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog'
import { ReasonDialog } from '@/components/dialogs/reason-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ta } from '@/i18n/admin'
import { formatDateTime, formatDistance, formatLatLng, formatRelative } from '@/lib/format'

import { useStationWrite } from './use-station-write'

// MapLibre chargé à la demande (hors JS initial et hors chunk de la fiche).
const LocationMap = lazy(() => import('@/components/map/location-map'))

const mapFallback = <Skeleton className="h-64 w-full rounded-lg" />

export function LocationCard({ s }: { s: Station }) {
  const { run } = useStationWrite(s.id)
  const [confirm, setConfirm] = useState(false)
  return (
    <Card>
      <CardHeader>
        <CardTitle>{ta.station.sections.location}</CardTitle>
        {s.location && (
          <CardDescription className="tabular-nums">
            {formatLatLng(s.location.lat, s.location.lng)}
            {s.locationSetAt && <> · {ta.common.since(formatRelative(s.locationSetAt))}</>}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {s.locationFlag && (
          <div
            role="status"
            className="flex flex-wrap items-start gap-3 rounded-lg border border-warning/40 bg-warning-subtle px-3 py-2.5 text-warning-subtle-foreground"
          >
            <Smartphone className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-sm font-medium">
                {ta.station.pinFlag(s.locationFlag.distanceM)}
                {s.locationFlag.accuracyM !== null && (
                  <span className="font-normal"> ({ta.station.accuracy(s.locationFlag.accuracyM)})</span>
                )}
              </p>
              <p className="text-xs">{ta.station.pinFlagBody}</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setConfirm(true)}>
              <Check aria-hidden />
              {ta.station.dismissFlag}
            </Button>
          </div>
        )}
        {s.location ? (
          <Suspense fallback={mapFallback}>
            <LocationMap
              label={ta.station.mapLabel(s.name)}
              points={[{ ...s.location, label: s.name, variant: 'primary' }]}
            />
          </Suspense>
        ) : (
          <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-6 text-sm text-muted-foreground">
            <MapPinned className="size-4" aria-hidden />
            {ta.station.noLocation}
          </p>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={ta.station.dismissFlagTitle}
        description={ta.station.dismissFlagBody}
        confirmLabel={ta.station.dismissFlag}
        onConfirm={() => run(dismissLocationFlag, ta.station.flagDismissed)}
      />
    </Card>
  )
}

/** Demande de déplacement : carte avant / après reliées, distance, valider ou refuser (motif). */
export function MoveRequestCard({ s }: { s: Station }) {
  const { run } = useStationWrite(s.id)
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null)
  const move = s.pendingMove
  if (!move) return null
  const points = [
    ...(s.location ? [{ ...s.location, label: ta.station.move.current, variant: 'muted' as const }] : []),
    { ...move.location, label: ta.station.move.requested, variant: 'primary' as const },
  ]
  return (
    <Card className="border-info/40 ring-1 ring-info/20" aria-labelledby="move-title">
      <CardHeader className="grid-cols-[1fr_auto]">
        <CardTitle id="move-title" className="flex items-center gap-2">
          {ta.station.move.title}
          <Badge variant="info">{formatDistance(move.distanceM)}</Badge>
        </CardTitle>
        <CardDescription>
          {ta.station.move.body(move.distanceM)} {ta.station.move.requestedAt}{' '}
          <time dateTime={move.createdAt} title={formatDateTime(move.createdAt)}>
            {formatRelative(move.createdAt)}
          </time>
          .
        </CardDescription>
        <div className="col-start-2 row-span-2 row-start-1 flex flex-wrap gap-2 self-start">
          <Button size="sm" variant="outline" onClick={() => setDialog('reject')}>
            <X aria-hidden />
            {ta.station.move.reject}
          </Button>
          <Button size="sm" onClick={() => setDialog('approve')}>
            <Check aria-hidden />
            {ta.station.move.approve}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid gap-3 text-sm sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <div className="flex flex-col gap-0.5 rounded-lg border bg-surface px-3 py-2">
            <dt className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
              <span className="size-2 rounded-full bg-neutral-500" aria-hidden />
              {ta.station.move.current}
            </dt>
            <dd className="tabular-nums">
              {s.location ? formatLatLng(s.location.lat, s.location.lng) : ta.common.none}
            </dd>
          </div>
          <ArrowRight className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
          <div className="flex flex-col gap-0.5 rounded-lg border border-primary/40 bg-primary-subtle/50 px-3 py-2">
            <dt className="flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
              <span className="size-2 rounded-full bg-primary" aria-hidden />
              {ta.station.move.requested}
            </dt>
            <dd className="tabular-nums">{formatLatLng(move.location.lat, move.location.lng)}</dd>
          </div>
        </dl>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Smartphone className="size-3.5" aria-hidden />
          {move.deviceDistanceM !== null ? ta.station.move.device(move.deviceDistanceM) : ta.station.move.noDevice}
          {move.deviceAccuracyM !== null && <> ({ta.station.accuracy(move.deviceAccuracyM)})</>}
        </p>
        <Suspense fallback={mapFallback}>
          <LocationMap label={ta.station.move.mapLabel} points={points} connect className="h-72" />
        </Suspense>
      </CardContent>
      <ConfirmDialog
        open={dialog === 'approve'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={ta.station.move.approve}
        description={ta.station.move.body(move.distanceM)}
        confirmLabel={ta.station.move.approve}
        onConfirm={() => run((cur) => decideMove(cur, move.id, true), ta.station.move.approved, ta.station.emailSent)}
      />
      <ReasonDialog
        open={dialog === 'reject'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={ta.station.move.rejectTitle}
        description={ta.station.move.rejectBody}
        confirmLabel={ta.station.move.reject}
        destructive
        onConfirm={(reason) =>
          run((cur) => decideMove(cur, move.id, false, reason), ta.station.move.rejected, ta.station.emailSent)
        }
      />
    </Card>
  )
}
