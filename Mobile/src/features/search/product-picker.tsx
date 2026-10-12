import { Droplet, Flame, Fuel, type LucideIcon } from 'lucide-react-native'
import { useMemo } from 'react'
import { View } from 'react-native'

import type { Product } from '@/api/schemas'
import { ChoiceTile, Chip } from '@/components/ui/choice-tile'
import { Skeleton } from '@/components/ui/skeleton'
import { Text } from '@/components/ui/text'
import { t } from '@/i18n'

export type Kind = Product['kind']
export const KINDS: Kind[] = ['lpg', 'petrol', 'diesel']
const ICONS: Record<Kind, LucideIcon> = { lpg: Flame, petrol: Fuel, diesel: Droplet }

const kg = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })

/**
 * Libellé court d'un produit : « Gaz 12,5 kg », « Essence ». Sans `kind` (stocks d'une fiche),
 * une taille en kg désigne du gaz ; sinon le libellé du catalogue.
 */
export function productLabel(p: { kind?: Kind; sizeKg: number | null; label: string }): string {
  const kind = p.kind ?? (p.sizeKg !== null ? 'lpg' : null)
  if (kind === 'lpg' && p.sizeKg !== null) return `${t.search.kinds.lpg} ${t.search.sizeLabel(kg.format(p.sizeKg))}`
  return (kind && p.kind ? t.search.kinds[kind] : null) ?? p.label
}

/**
 * Choix du produit : trois grands boutons (Gaz, Essence, Gasoil), puis la taille de bouteille pour
 * le gaz, d'après le catalogue de l'API (ordre du catalogue, tailles croissantes).
 */
export function ProductPicker({
  products,
  productId,
  onChange,
}: {
  products: Product[] | undefined
  productId: number | null
  onChange: (id: number) => void
}) {
  const byKind = useMemo(() => {
    const m: Record<Kind, Product[]> = { lpg: [], petrol: [], diesel: [] }
    for (const p of products ?? []) m[p.kind].push(p)
    m.lpg.sort((a, b) => (a.sizeKg ?? 0) - (b.sizeKg ?? 0))
    return m
  }, [products])
  const selected = products?.find((p) => p.id === productId)
  const kind = selected?.kind ?? null

  if (!products) {
    return (
      <View className="flex-row gap-3">
        {KINDS.map((k) => (
          <Skeleton key={k} height={88} className="flex-1 rounded-xl" />
        ))}
      </View>
    )
  }

  const pickKind = (k: Kind) => {
    if (k === kind) return
    const first = byKind[k][k === 'lpg' ? Math.min(1, byKind[k].length - 1) : 0]
    if (first) onChange(first.id)
  }

  return (
    <View className="gap-4">
      <View className="flex-row gap-3" accessibilityRole="radiogroup" accessibilityLabel={t.search.title}>
        {KINDS.filter((k) => byKind[k].length > 0).map((k) => (
          <ChoiceTile
            key={k}
            testID={`kind-${k}`}
            icon={ICONS[k]}
            label={t.search.kinds[k] ?? k}
            hint={t.search.kindHints[k]}
            selected={kind === k}
            onPress={() => pickKind(k)}
          />
        ))}
      </View>
      {kind === 'lpg' && byKind.lpg.length > 1 && (
        <View className="gap-2">
          <Text variant="footnote" weight="medium" tone="muted">
            {t.search.size}
          </Text>
          <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup" accessibilityLabel={t.search.size}>
            {byKind.lpg.map((p) => (
              <Chip
                key={p.id}
                testID={`size-${p.code}`}
                label={p.sizeKg ? t.search.sizeLabel(kg.format(p.sizeKg)) : p.label}
                selected={p.id === productId}
                onPress={() => onChange(p.id)}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  )
}
