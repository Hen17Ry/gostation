import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { useCursorPages } from './use-cursor-pages'

function usePager(initialKey: string) {
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [key, setKey] = useState(initialKey)
  return { cursor, setKey, pages: useCursorPages(cursor, setCursor, key) }
}

describe('pagination par curseur', () => {
  it('suivant empile, précédent dépile jusqu’à la première page', () => {
    const { result } = renderHook(() => usePager('f1'))
    expect(result.current.pages).toMatchObject({ page: 1, hasPrevious: false })
    act(() => result.current.pages.next('c2'))
    expect(result.current.cursor).toBe('c2')
    act(() => result.current.pages.next('c3'))
    expect(result.current.pages).toMatchObject({ page: 3, hasPrevious: true })
    act(() => result.current.pages.previous())
    expect(result.current.cursor).toBe('c2')
    act(() => result.current.pages.previous())
    expect(result.current.cursor).toBeUndefined()
    expect(result.current.pages.hasPrevious).toBe(false)
  })

  it('changer de filtres oublie la pile', () => {
    const { result } = renderHook(() => usePager('f1'))
    act(() => result.current.pages.next('c2'))
    act(() => result.current.setKey('f2'))
    // Le curseur de l'URL est remis à zéro par l'écran ; la pile, elle, est vidée ici.
    act(() => result.current.pages.previous())
    expect(result.current.cursor).toBeUndefined()
  })
})
