import { useQuery, useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { Save } from 'lucide-react-native'
import { useState } from 'react'
import { View } from 'react-native'

import { isApiError } from '@/api/errors'
import { invalidateOtherVersions, isVersionConflict, setStationProducts, stationProductsQuery } from '@/api/manager'
import type { StationProduct } from '@/api/schemas'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { SwitchRow } from '@/components/ui/list-row'
import { Screen } from '@/components/ui/screen'
import { Section } from '@/components/ui/section'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import { haptics } from '@/lib/haptics'

const soldSet = (items: StationProduct[]) => new Set(items.filter((p) => p.sold).map((p) => p.id))

/**
 * Produits vendus (D16, D64) : un interrupteur par produit actif du catalogue de l'API. « Non
 * vendu » ≠ « 0 en stock » : un produit ajouté démarre à 0. Sur 412, les choix du gérant sont
 * gardés et les autres recalés sur la version à jour.
 */
export function ProductsScreen() {
  const qc = useQueryClient()
  const q = useQuery(stationProductsQuery)
  // Choix locaux, partis de la dernière lecture de l'API (sans recopie dans un effet).
  const [choice, setSold] = useState<Set<number> | null>(null)
  const [edited, setEdited] = useState<Set<number>>(new Set())
  const [writtenEtag, setEtag] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const items = q.data?.data.items ?? []
  const initial = q.data ? soldSet(q.data.data.items) : new Set<number>()
  const sold = choice ?? (q.data ? initial : null)
  const etag = writtenEtag ?? q.data?.etag ?? null
  const dirty = sold !== null && (sold.size !== initial.size || [...sold].some((id) => !initial.has(id)))
  const added = sold ? [...sold].some((id) => !initial.has(id)) : false

  const toggle = (id: number, on: boolean) => {
    const next = new Set(sold)
    if (on) next.add(id)
    else next.delete(id)
    setSold(next)
    setEdited((prev) => new Set(prev).add(id))
  }

  const save = async () => {
    if (!sold || !etag) return
    setBusy(true)
    setNotice(null)
    try {
      const res = await setStationProducts([...sold], etag)
      qc.setQueryData(stationProductsQuery.queryKey, res)
      void invalidateOtherVersions(qc, stationProductsQuery.queryKey)
      haptics.success()
      toast.success(t.manager.products.saved)
      router.back()
    } catch (e) {
      if (isVersionConflict(e)) {
        const fresh = await qc.fetchQuery({ ...stationProductsQuery, staleTime: 0 }).catch(() => null)
        if (fresh) {
          const merged = soldSet(fresh.data.items)
          for (const id of edited) {
            if (sold.has(id)) merged.add(id)
            else merged.delete(id)
          }
          setSold(merged)
          setEtag(fresh.etag)
        }
        haptics.warning()
        setNotice(t.manager.station.conflictBody)
        return
      }
      haptics.error()
      setNotice(isApiError(e) ? e.userMessage : t.common.errorTitle)
    } finally {
      setBusy(false)
    }
  }

  const group = (title: string, list: StationProduct[]) =>
    list.length > 0 && (
      <Section title={title}>
        <Card flush className="overflow-hidden">
          {list.map((p) => (
            <SwitchRow
              key={p.id}
              testID={`product-${p.code}`}
              title={p.label}
              value={sold?.has(p.id) ?? p.sold}
              onValueChange={(on) => toggle(p.id, on)}
            />
          ))}
        </Card>
      </Section>
    )

  return (
    <Screen
      title={t.manager.products.title}
      subtitle={t.manager.products.subtitle}
      footer={
        <Button
          testID="products-save"
          label={t.manager.products.save}
          icon={Save}
          size="lg"
          loading={busy}
          disabled={!dirty}
          onPress={save}
        />
      }
    >
      {notice && <Banner tone="warning">{notice}</Banner>}
      {q.isError && !q.data && (
        <Banner
          tone="danger"
          action={<Button label={t.common.retry} size="sm" variant="outline" onPress={() => q.refetch()} />}
        >
          {isApiError(q.error) ? q.error.userMessage : t.common.errorTitle}
        </Banner>
      )}
      {!q.data ? (
        <View className="gap-3">
          <Skeleton height={56} />
          <Skeleton height={224} />
        </View>
      ) : (
        <>
          {group(
            t.manager.products.lpg,
            items.filter((p) => p.kind === 'lpg'),
          )}
          {group(
            t.manager.products.fuels,
            items.filter((p) => p.kind !== 'lpg'),
          )}
          {added && <Banner tone="info">{t.manager.products.newAtZero}</Banner>}
        </>
      )}
    </Screen>
  )
}
