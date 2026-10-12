import { arrayMove } from '@dnd-kit/sortable'

import type { Product } from '@/api/admin-schemas'

/**
 * Nouvel ordre après un déplacement : si possible une seule écriture (valeur entre les deux
 * voisins), sinon renumérotation de 10 en 10. Renvoie les produits à mettre à jour.
 */
export function reorder(list: Product[], from: number, to: number): { list: Product[]; writes: Product[] } {
  const moved = arrayMove(list, from, to)
  const prev = moved[to - 1]?.sortOrder
  const next = moved[to + 1]?.sortOrder
  let target: number | null = null
  if (prev === undefined && next !== undefined && next > 0) target = Math.max(0, next - 10)
  else if (next === undefined && prev !== undefined && prev < 9999) target = Math.min(9999, prev + 10)
  else if (prev !== undefined && next !== undefined && next - prev > 1) target = Math.floor((prev + next) / 2)
  if (target !== null) {
    const item = { ...moved[to]!, sortOrder: target }
    return { list: moved.map((p, i) => (i === to ? item : p)), writes: [item] }
  }
  const renumbered = moved.map((p, i) => ({ ...p, sortOrder: (i + 1) * 10 }))
  return { list: renumbered, writes: renumbered.filter((p, i) => p.sortOrder !== moved[i]!.sortOrder) }
}
