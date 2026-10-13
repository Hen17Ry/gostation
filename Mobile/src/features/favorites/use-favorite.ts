import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { favoritesQuery, removeFavorite, saveFavorite } from '@/api/account'
import { isApiError } from '@/api/errors'
import { meKeys } from '@/api/keys'
import type { Favorite } from '@/api/schemas'
import { toast } from '@/components/ui/toast'
import { useRequireAccount } from '@/features/auth/use-require-account'
import { t } from '@/i18n'
import { haptics } from '@/lib/haptics'

/** Favori d'une station : état et bascule (mise à jour optimiste, annulée en cas d'échec). */
export function useFavorite(stationId: string) {
  const qc = useQueryClient()
  const { ready, ensure } = useRequireAccount()
  const favorites = useQuery({ ...favoritesQuery, enabled: ready })
  const current = favorites.data?.find((f) => f.station.id === stationId)

  const toggle = useMutation({
    mutationFn: async (add: boolean) => (add ? saveFavorite(stationId) : removeFavorite(stationId)),
    onMutate: async (add) => {
      await qc.cancelQueries({ queryKey: meKeys.favorites() })
      const previous = qc.getQueryData(favoritesQuery.queryKey)
      if (previous && !add) {
        qc.setQueryData(favoritesQuery.queryKey, { items: previous.items.filter((f) => f.station.id !== stationId) })
      }
      return { previous }
    },
    onSuccess: (_d, add) => {
      haptics.success()
      toast.success(add ? t.station.favoriteAdded : t.station.favoriteRemoved)
    },
    onError: (e, _add, ctx) => {
      if (ctx?.previous) qc.setQueryData(favoritesQuery.queryKey, ctx.previous)
      haptics.error()
      toast.error(isApiError(e) ? e.userMessage : t.common.errorTitle)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: meKeys.favorites() }),
  })

  return {
    isFavorite: !!current,
    favorite: current as Favorite | undefined,
    pending: toggle.isPending,
    toggle: () => {
      if (!ensure()) return
      toggle.mutate(!current)
    },
  }
}
