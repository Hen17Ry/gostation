import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** Liste de champs libellé / valeur (fiches) ; deux colonnes dès que la place le permet. */
export function DefinitionList({
  items,
  className,
  columns = 2,
}: {
  items: Array<{ label: string; value: ReactNode; wide?: boolean } | false | null | undefined | ''>
  className?: string
  columns?: 1 | 2
}) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-3', columns === 2 && 'sm:grid-cols-2', className)}>
      {items.filter(Boolean).map((it) => {
        const { label, value, wide } = it as { label: string; value: ReactNode; wide?: boolean }
        return (
          <div key={label} className={cn('flex min-w-0 flex-col gap-0.5', wide && 'sm:col-span-2')}>
            <dt className="text-2xs font-medium text-muted-foreground">{label}</dt>
            <dd className="text-sm break-words text-foreground">{value}</dd>
          </div>
        )
      })}
    </dl>
  )
}
