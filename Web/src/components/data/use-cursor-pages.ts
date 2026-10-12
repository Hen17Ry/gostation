import { useState } from 'react'

/**
 * Pagination par curseur côté serveur. Le curseur courant vit dans l'URL (lien profond) ; la pile
 * des curseurs précédents vit dans l'état (perdue au rechargement : « Précédent » revient alors à
 * la première page). Elle est remise à zéro quand les filtres changent (`resetKey`).
 */
export function useCursorPages(
  cursor: string | undefined,
  setCursor: (c: string | undefined) => void,
  resetKey: string,
) {
  const [state, setState] = useState<{ key: string; stack: Array<string | undefined> }>({ key: resetKey, stack: [] })
  const stack = state.key === resetKey ? state.stack : []
  if (state.key !== resetKey) setState({ key: resetKey, stack: [] })
  const hasPrevious = stack.length > 0 || cursor !== undefined
  return {
    page: cursor === undefined ? 1 : Math.max(2, stack.length + 1),
    hasPrevious,
    next(nextCursor: string) {
      setState({ key: resetKey, stack: [...stack, cursor] })
      setCursor(nextCursor)
    },
    previous() {
      const prev = stack.at(-1)
      setState({ key: resetKey, stack: stack.slice(0, -1) })
      setCursor(stack.length > 0 ? prev : undefined)
    },
  }
}
