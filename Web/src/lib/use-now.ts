import { useEffect, useState } from 'react'

/** Heure courante (ms), mise à jour toutes les `intervalMs` : rendu pur, libellés « il y a » à jour. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
