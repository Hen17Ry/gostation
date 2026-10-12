import { ChevronRight, Clock3, Flag, Navigation, TriangleAlert } from 'lucide-react-native'
import { memo } from 'react'
import { Pressable, View } from 'react-native'

import type { SearchResult } from '@/api/schemas'
import { Badge } from '@/components/ui/badge'
import { Text } from '@/components/ui/text'
import { t } from '@/i18n'
import { cn } from '@/lib/cn'
import { formatAgo, formatDistance, formatDuration, formatQuantity, formatReopening } from '@/lib/format'
import { alpha, useTheme } from '@/theme/theme'

/**
 * Résultat de recherche : rang, nom et marque, distance et durée (≈ si estimées), quantité,
 * fraîcheur (« mis à jour il y a »), badges « À vérifier » (stale) et « Signalée », « Fermée ·
 * rouvre à HH:MM ». Bouton Itinéraire direct (le reste de la carte ouvre la fiche).
 */
export const ResultCard = memo(function ResultCard({
  result: r,
  rank,
  unit,
  approximate,
  selected,
  onOpen,
  onRoute,
}: {
  result: SearchResult
  rank: number
  unit: 'cylinder' | 'liter'
  approximate: boolean
  selected: boolean
  onOpen: (id: string) => void
  onRoute: (id: string) => void
}) {
  const { colors } = useTheme()
  const distance = formatDistance(r.routeDistanceM ?? r.distanceM)
  const duration = r.durationS !== null ? formatDuration(r.durationS) : null
  const approx = approximate || r.routeDistanceM === null ? '≈ ' : ''
  const travel = duration ? `${approx}${distance} · ${approx}${duration}` : `${approx}${distance}`
  const quantity = formatQuantity(unit, r.quantity)
  const closedText = !r.isOpen
    ? r.nextOpening
      ? t.result.closedReopens(formatReopening(r.nextOpening))
      : t.result.closed
    : null
  const a11y = [
    `${rank}. ${r.station.name}`,
    r.station.brand,
    travel.replaceAll('≈', 'environ'),
    quantity,
    closedText ?? t.result.open,
    t.result.updated(formatAgo(r.updatedAgoS)),
    r.stale ? t.result.staleHint : null,
    r.reported ? t.result.reportedHint : null,
  ]
    .filter(Boolean)
    .join(', ')

  return (
    // Pressable natif (ripple Android) plutôt qu'une zone animée Reanimated : moins de travail par
    // cellule quand la liste défile.
    <Pressable
      testID={`result-${rank}`}
      android_ripple={{ color: colors.accent, foreground: true }}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected }}
      onPress={() => onOpen(r.station.id)}
      className={cn(
        'mx-4 mb-3 overflow-hidden rounded-xl border bg-card p-4',
        selected ? 'border-primary' : 'border-border',
      )}
      style={selected ? { borderWidth: 2, padding: 15 } : undefined}
    >
      <View className="flex-row gap-3">
        <View
          className={cn('h-8 w-8 items-center justify-center rounded-full', r.isOpen ? 'bg-primary' : 'bg-secondary')}
          accessibilityElementsHidden
        >
          <Text variant="subhead" weight="bold" tone={r.isOpen ? 'onPrimary' : 'muted'}>
            {rank}
          </Text>
        </View>
        <View className="flex-1 gap-1">
          <View className="flex-row items-center gap-1">
            <Text variant="headline" numberOfLines={1} className="flex-1">
              {r.station.name}
            </Text>
            <ChevronRight size={18} color={colors['muted-foreground']} />
          </View>
          <Text variant="footnote" tone="muted" numberOfLines={1}>
            {[r.station.brand, travel].filter(Boolean).join(' · ')}
          </Text>
          <View className="mt-1.5 flex-row flex-wrap items-center gap-1.5">
            <View className="rounded-md bg-success-subtle px-2 py-0.5">
              <Text variant="subhead" weight="semibold" tone="success">
                {quantity}
              </Text>
            </View>
            {r.stale && <Badge label={t.result.stale} tone="warning" icon={Clock3} />}
            {r.reported && <Badge label={t.result.reported} tone="danger" icon={Flag} />}
          </View>
          <View className="mt-2 flex-row items-center justify-between gap-2">
            <View className="flex-1 gap-0.5">
              {closedText && (
                <View className="flex-row items-center gap-1">
                  <TriangleAlert size={14} color={colors['warning-subtle-foreground']} />
                  <Text variant="footnote" weight="semibold" tone="warning" numberOfLines={1}>
                    {closedText}
                  </Text>
                </View>
              )}
              <Text variant="caption" tone="muted" numberOfLines={1}>
                {t.result.updated(formatAgo(r.updatedAgoS))}
              </Text>
            </View>
            <Pressable
              testID={`result-${rank}-route`}
              android_ripple={{ color: alpha(colors['primary-subtle-foreground'], 0.2), foreground: true }}
              accessibilityRole="button"
              accessibilityLabel={`${t.station.route} : ${r.station.name}`}
              onPress={() => onRoute(r.station.id)}
              hitSlop={6}
              className="h-10 flex-row items-center gap-1.5 overflow-hidden rounded-full bg-primary-subtle px-3.5"
            >
              <Navigation size={16} color={colors['primary-subtle-foreground']} strokeWidth={2.4} />
              <Text variant="subhead" weight="semibold" className="text-primary-subtle-foreground">
                {t.station.route}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Pressable>
  )
})
