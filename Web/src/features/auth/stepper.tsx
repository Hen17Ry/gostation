import { Check } from 'lucide-react'

import { t } from '@/i18n'
import { cn } from '@/lib/utils'

const steps = [t.auth.setupStepScan, t.auth.setupStepVerify, t.auth.setupStepSave]

/** Progression de la mise en place de la 2FA : Scanner → Vérifier → Sauvegarder. */
export function SetupStepper({ current }: { current: 0 | 1 | 2 }) {
  return (
    <ol className="flex items-center gap-2" aria-label={t.auth.setupTitle}>
      {steps.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo'
        return (
          <li
            key={label}
            className="flex flex-1 items-center gap-2"
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full text-2xs font-semibold transition-colors duration-(--duration-base)',
                state === 'done' && 'bg-primary text-primary-foreground',
                state === 'current' && 'bg-primary-subtle text-primary-subtle-foreground ring-2 ring-primary',
                state === 'todo' && 'bg-muted text-muted-foreground',
              )}
            >
              {state === 'done' ? <Check className="size-3.5" aria-hidden /> : i + 1}
            </span>
            <span className={cn('text-xs', state === 'todo' ? 'text-muted-foreground' : 'font-medium text-foreground')}>
              {label}
              {state === 'done' && <span className="sr-only"> (terminé)</span>}
            </span>
            {i < steps.length - 1 && (
              <span aria-hidden className={cn('h-px flex-1', i < current ? 'bg-primary' : 'bg-border')} />
            )}
          </li>
        )
      })}
    </ol>
  )
}
