import { RotateCw } from 'lucide-react'

import { isApiError } from '@/api/errors'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'

import { EmptyState } from './empty-state'
import { ErrorIllustration } from './illustrations'

/** Erreur d'un bloc ou d'une page : message français issu du code stable, référence, réessai. */
export function ErrorState({
  error,
  onRetry,
  size = 'md',
  className,
}: {
  error: unknown
  onRetry?: () => void
  size?: 'sm' | 'md'
  className?: string
}) {
  const message = isApiError(error) ? error.userMessage : t.errors.title
  const requestId = isApiError(error) ? error.requestId : undefined
  return (
    <div role="alert" className={className}>
      <EmptyState
        size={size}
        illustration={<ErrorIllustration className={size === 'sm' ? 'h-16 w-20' : undefined} />}
        title={t.errors.title}
        description={
          <>
            {message}
            {requestId && <span className="mt-1 block font-mono text-2xs">{t.errors.requestId(requestId)}</span>}
          </>
        }
        action={
          onRetry && (
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RotateCw aria-hidden />
              {t.errors.retry}
            </Button>
          )
        }
      />
    </div>
  )
}
