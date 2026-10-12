import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/**
 * État vide : illustration, titre, explication et action facultative. Inspiré du bloc « Empty »
 * de 21st.dev (média, titre, description, contenu), aux tokens de GoStation.
 */
export function EmptyState({
  illustration,
  title,
  description,
  action,
  className,
  size = 'md',
  headingLevel = 3,
}: {
  illustration?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
  size?: 'sm' | 'md'
  headingLevel?: 1 | 2 | 3
}) {
  const Heading = `h${headingLevel}` as const
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        size === 'sm' ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-12',
        className,
      )}
    >
      {illustration}
      <div className="flex max-w-sm flex-col gap-1">
        <Heading className={cn('font-semibold text-foreground', size === 'sm' ? 'text-sm' : 'text-base')}>
          {title}
        </Heading>
        {description && <p className="text-xs text-pretty text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  )
}
