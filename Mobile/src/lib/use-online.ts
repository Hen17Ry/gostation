import { onlineManager } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

/** En ligne ? (NetInfo via onlineManager) */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
  )
}
