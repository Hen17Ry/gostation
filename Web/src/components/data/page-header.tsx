import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** En-tête de page : titre (h1), description, actions à droite (passent sous le titre en étroit). */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  eyebrow?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow}
        <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="text-xs text-pretty text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
