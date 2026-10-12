import { type ReactNode, useId } from 'react'

import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export interface FieldControlProps {
  id: string
  'aria-invalid': boolean | undefined
  'aria-describedby': string | undefined
}

/**
 * Champ de formulaire : libellé visible, aide et erreur au plus près du contrôle, reliées par
 * aria-describedby ; l'erreur est annoncée (role=alert).
 */
export function Field({
  label,
  hint,
  error,
  className,
  labelAction,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: string
  className?: string
  labelAction?: ReactNode
  children: (props: FieldControlProps) => ReactNode
}) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {labelAction}
      </div>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
      {hint && !error && (
        <p id={hintId} className="text-2xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-2xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
