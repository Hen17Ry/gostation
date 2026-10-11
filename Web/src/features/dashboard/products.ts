import type { Dashboard } from '@/api/schemas'

const MAX_SLOTS = 8

/**
 * Couleur d'un produit : suit l'entité (ordre des identifiants), jamais son rang ni la période.
 * Huit emplacements validés (palette dataviz) ; au-delà, pas de couleur inventée.
 */
export function productSlots(d: Dashboard) {
  const products = d.searches.byProduct.map((p) => p.product).sort((a, b) => a.id - b.id)
  return products.slice(0, MAX_SLOTS).map((p, i) => ({ ...p, color: `var(--chart-${i + 1})` }))
}
