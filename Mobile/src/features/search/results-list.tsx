import { FlashList, type FlashListRef, type FlashListProps } from '@shopify/flash-list'
import { forwardRef, type ReactElement, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'

import type { SearchResult } from '@/api/schemas'
import { t } from '@/i18n'

import { ResultCard } from './result-card'

/** Cartes montées avec les résultats : celles que montre le cran du milieu du panneau. */
const FIRST_CARDS = 2
/** Les autres attendent la fin des animations du panneau et de la caméra (≈ 600 ms), puis une par image. */
const REST_DELAY_MS = 650
/**
 * Distance de rendu couvrant toute la liste (10 résultats, 20 au plus, ≈ 190 dp chacun) : une fois
 * montées, les cartes ne sont plus recyclées, le défilement reste natif (ni rendu JS ni mise à jour
 * des textes pendant le geste, cf. docs/performance.md).
 */
const DRAW_DISTANCE = 4000

export interface ResultsListHandle {
  /** Fait défiler jusqu'au résultat (monte d'abord les cartes qui manquent). */
  scrollToResult: (index: number) => void
}

interface Props {
  results: SearchResult[]
  unit: 'cylinder' | 'liter'
  approximate: boolean
  selectedId: string | null
  onOpen: (id: string) => void
  onRoute: (id: string) => void
  header: ReactElement
  empty: ReactElement | null
  renderScrollComponent: FlashListProps<SearchResult>['renderScrollComponent']
}

/**
 * Liste des résultats dans le panneau. Montage par étapes : créer les vues natives de toutes les
 * cartes dans la même image coûtait 140 ms au thread principal sur le S10 (image perdue à
 * l'arrivée des résultats, pendant l'ouverture du panneau).
 */
export const ResultsList = forwardRef<ResultsListHandle, Props>(function ResultsList(
  { results, unit, approximate, selectedId, onOpen, onRoute, header, empty, renderScrollComponent },
  ref,
) {
  const list = useRef<FlashListRef<SearchResult>>(null)
  const { count, revealAll } = useStagedCount(results)

  useImperativeHandle(ref, () => ({
    scrollToResult(index) {
      const scroll = () => list.current?.scrollToIndex({ index, animated: true, viewPosition: 0 })
      if (index < count) {
        requestAnimationFrame(scroll)
        return
      }
      revealAll()
      requestAnimationFrame(() => requestAnimationFrame(scroll))
    },
  }))

  return (
    <FlashList
      ref={list}
      style={{ flex: 1 }}
      data={count < results.length ? results.slice(0, count) : results}
      keyExtractor={(r) => r.station.id}
      renderScrollComponent={renderScrollComponent}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      extraData={selectedId}
      drawDistance={DRAW_DISTANCE}
      renderItem={({ item, index }) => (
        <ResultCard
          result={item}
          rank={index + 1}
          unit={unit}
          approximate={approximate}
          selected={item.station.id === selectedId}
          onOpen={onOpen}
          onRoute={onRoute}
        />
      )}
      contentContainerStyle={{ paddingBottom: 24 }}
      accessibilityLabel={t.search.resultsLabel}
    />
  )
})

/**
 * Nombre de cartes à montrer pour cette liste : `FIRST_CARDS` au premier rendu (calculé pendant le
 * rendu, pour que la première image n'en monte pas plus), puis une de plus par image après
 * `REST_DELAY_MS`.
 */
export function useStagedCount(items: readonly SearchResult[]) {
  const first = Math.min(FIRST_CARDS, items.length)
  const [staged, setStaged] = useState({ items, count: first })

  useEffect(() => {
    let n = Math.min(FIRST_CARDS, items.length)
    if (n >= items.length) return
    let raf = 0
    const step = () => {
      n += 1
      setStaged({ items, count: n })
      if (n < items.length) raf = requestAnimationFrame(step)
    }
    const timer = setTimeout(() => {
      raf = requestAnimationFrame(step)
    }, REST_DELAY_MS)
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(raf)
    }
  }, [items])

  const revealAll = useCallback(() => setStaged({ items, count: items.length }), [items])
  return { count: staged.items === items ? staged.count : first, revealAll }
}
