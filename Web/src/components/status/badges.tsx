import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Clock,
  Hourglass,
  type LucideIcon,
  OctagonX,
  PauseCircle,
} from 'lucide-react'

import type { StationFreshness, StationStatus } from '@/api/admin-schemas'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ta } from '@/i18n/admin'
import { formatRelative } from '@/lib/format'

type Variant = 'success' | 'warning' | 'danger' | 'info' | 'secondary' | 'brand' | 'outline'

const STATION: Record<StationStatus, { variant: Variant; icon: LucideIcon }> = {
  pending: { variant: 'info', icon: Hourglass },
  approved: { variant: 'success', icon: CircleCheck },
  rejected: { variant: 'danger', icon: OctagonX },
  suspended: { variant: 'warning', icon: PauseCircle },
}

/** Statut d'une station : icône + libellé (jamais la couleur seule). */
export function StationStatusBadge({ status }: { status: StationStatus }) {
  const { variant, icon: Icon } = STATION[status]
  return (
    <Badge variant={variant}>
      <Icon aria-hidden />
      {ta.station.statuses[status]}
    </Badge>
  )
}

const FRESHNESS: Record<StationFreshness, { variant: Variant; icon: LucideIcon }> = {
  fresh: { variant: 'success', icon: CircleCheck },
  stale: { variant: 'warning', icon: Clock },
  expired: { variant: 'danger', icon: CircleSlash },
  none: { variant: 'secondary', icon: CircleDashed },
}

/** Fraîcheur des stocks, avec « mis à jour il y a … » en info-bulle et en texte lu. */
export function FreshnessBadge({ freshness, at }: { freshness: StationFreshness; at?: string | null }) {
  const { variant, icon: Icon } = FRESHNESS[freshness]
  const rel = at ? formatRelative(at) : null
  const badge = (
    <Badge variant={variant}>
      <Icon aria-hidden />
      {ta.station.freshness[freshness]}
      {rel && <span className="sr-only">, {ta.common.updatedAgo(rel)}</span>}
    </Badge>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="rounded-full">{badge}</span>
      </TooltipTrigger>
      <TooltipContent>
        {ta.station.freshnessHints[freshness]}
        {rel && <> · {ta.common.updatedAgo(rel)}</>}
      </TooltipContent>
    </Tooltip>
  )
}

/** Indicateur d'alerte compact (signalée, exclue, épingle…), avec info-bulle. */
export function FlagBadge({ label, hint, variant = 'warning' }: { label: string; hint?: string; variant?: Variant }) {
  const badge = (
    <Badge variant={variant}>
      <CircleAlert aria-hidden />
      {label}
    </Badge>
  )
  if (!hint) return badge
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="rounded-full">{badge}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{hint}</TooltipContent>
    </Tooltip>
  )
}
