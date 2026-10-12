import { useEffect, useRef, useState } from 'react'

/** Secondes restantes avant `deadline` (ms epoch) ; `onEnd` est appelé une fois à zéro. */
export function useCountdown(deadline: number, onEnd: () => void): number {
  const [left, setLeft] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
  const ended = useRef(false)
  const onEndRef = useRef(onEnd)
  useEffect(() => {
    onEndRef.current = onEnd
  })
  useEffect(() => {
    ended.current = false
    const tick = () => {
      const s = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setLeft(s)
      if (s === 0 && !ended.current) {
        ended.current = true
        onEndRef.current()
      }
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [deadline])
  return left
}
