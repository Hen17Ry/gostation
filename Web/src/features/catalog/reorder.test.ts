import { describe, expect, it } from 'vitest'

import type { Product } from '@/api/admin-schemas'

import { reorder } from './reorder'

const p = (id: number, sortOrder: number) => ({ id, sortOrder, label: `P${id}` }) as Product

describe('reorder', () => {
  it('écrit un seul produit quand il reste de la place entre ses voisins', () => {
    const list = [p(1, 10), p(2, 20), p(3, 30)]
    const { list: next, writes } = reorder(list, 2, 0)
    expect(next.map((x) => x.id)).toEqual([3, 1, 2])
    expect(writes).toEqual([expect.objectContaining({ id: 3, sortOrder: 0 })])
  })

  it('place entre deux voisins à la valeur médiane', () => {
    const { writes } = reorder([p(1, 10), p(2, 20), p(3, 30)], 0, 1)
    expect(writes).toEqual([expect.objectContaining({ id: 1, sortOrder: 25 })])
  })

  it('renumérote de 10 en 10 quand les voisins sont contigus', () => {
    const { list, writes } = reorder([p(1, 1), p(2, 2), p(3, 3)], 2, 1)
    expect(list.map((x) => [x.id, x.sortOrder])).toEqual([
      [1, 10],
      [3, 20],
      [2, 30],
    ])
    expect(writes.map((x) => x.id)).toEqual([1, 3, 2])
  })

  it('ajoute 10 après le dernier', () => {
    const { writes } = reorder([p(1, 10), p(2, 20), p(3, 30)], 0, 2)
    expect(writes).toEqual([expect.objectContaining({ id: 1, sortOrder: 40 })])
  })
})
