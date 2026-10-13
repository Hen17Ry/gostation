import { useEffect, useState } from 'react'

/** Heure courante rafraîchie à intervalle régulier (heures d'arrivée, « il y a ») sans impureté au rendu. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
