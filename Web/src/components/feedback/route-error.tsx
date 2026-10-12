import { useQueryErrorResetBoundary } from '@tanstack/react-query'
import { type ErrorComponentProps, useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'

import { ErrorState } from './error-state'

/** Error boundary par écran (CLAUDE.md) : jamais de message technique brut. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  const queryReset = useQueryErrorResetBoundary()
  useEffect(() => queryReset.reset(), [queryReset])
  return (
    <ErrorState
      error={error}
      className="mx-auto max-w-lg py-10"
      onRetry={() => {
        reset()
        void router.invalidate()
      }}
    />
  )
}
