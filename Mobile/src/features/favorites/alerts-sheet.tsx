import { BottomSheetModal, BottomSheetScrollView, BottomSheetBackdrop } from '@gorhom/bottom-sheet'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { BackHandler, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { favoritesQuery, saveFavorite } from '@/api/account'
import { isApiError } from '@/api/errors'
import { stationQuery } from '@/api/public'
import type { Favorite } from '@/api/schemas'
import { SwitchRow } from '@/components/ui/list-row'
import { Skeleton } from '@/components/ui/skeleton'
import { Text } from '@/components/ui/text'
import { toast } from '@/components/ui/toast'
import { productLabel } from '@/features/search/product-picker'
import { t } from '@/i18n'
import { useTheme } from '@/theme/theme'

/**
 * Alertes « de retour en stock » d'un favori : un interrupteur par produit vendu par la station.
 * Chaque bascule enregistre la liste complète (l'API remplace les produits suivis).
 */
export const AlertsSheet = forwardRef<BottomSheetModal, { favorite: Favorite | null }>(function AlertsSheet(
  { favorite },
  ref,
) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const modal = useRef<BottomSheetModal>(null)
  const [open, setOpen] = useState(false)
  useImperativeHandle(ref, () => modal.current!, [])

  // Bouton retour d'Android : ferme la feuille au lieu de quitter l'écran.
  useEffect(() => {
    if (!open) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      modal.current?.dismiss()
      return true
    })
    return () => sub.remove()
  }, [open])

  return (
    <BottomSheetModal
      ref={modal}
      enableDynamicSizing
      onChange={(index) => setOpen(index >= 0)}
      backgroundStyle={{ backgroundColor: colors.surface, borderRadius: 24 }}
      handleIndicatorStyle={{ backgroundColor: colors['border-strong'], width: 40 }}
      backdropComponent={(p) => <BottomSheetBackdrop {...p} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.4} />}
    >
      <BottomSheetScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}>
        {favorite && <AlertsBody favorite={favorite} />}
      </BottomSheetScrollView>
    </BottomSheetModal>
  )
})

function AlertsBody({ favorite }: { favorite: Favorite }) {
  const qc = useQueryClient()
  const station = useQuery(stationQuery(favorite.station.id))
  const [ids, setIds] = useState<number[]>(favorite.alertProductIds)
  const save = useMutation({
    mutationFn: (next: number[]) => saveFavorite(favorite.station.id, next),
    onSuccess: () => qc.invalidateQueries({ queryKey: favoritesQuery.queryKey }),
    onError: (e) => {
      setIds(favorite.alertProductIds)
      toast.error(isApiError(e) ? e.userMessage : t.common.errorTitle)
    },
  })
  const toggle = (productId: number, on: boolean) => {
    const next = on ? [...new Set([...ids, productId])] : ids.filter((x) => x !== productId)
    setIds(next)
    save.mutate(next)
  }
  return (
    <View className="gap-3 pt-1">
      <View className="gap-1 px-5">
        <Text variant="title3" accessibilityRole="header">
          {t.favorites.alerts}
        </Text>
        <Text variant="subhead" tone="muted">
          {favorite.station.name}
        </Text>
        <Text variant="footnote" tone="muted">
          {t.favorites.alertsHint}
        </Text>
      </View>
      {!station.data ? (
        <View className="gap-2 px-5">
          <Skeleton height={56} />
          <Skeleton height={56} />
        </View>
      ) : (
        <View>
          {station.data.stocks.map((s) => (
            <SwitchRow
              key={s.productId}
              title={productLabel(s)}
              value={ids.includes(s.productId)}
              onValueChange={(v) => toggle(s.productId, v)}
            />
          ))}
        </View>
      )}
    </View>
  )
}
