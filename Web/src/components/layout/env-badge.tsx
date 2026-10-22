import { FlaskConical } from 'lucide-react'

import { t } from '@/i18n'
import { cn } from '@/lib/utils'
import { isStaging } from '@/lib/app-env'

/** Liseré en haut de chaque page du staging (décoratif : le badge porte le texte). */
export function EnvRibbon() {
  if (!isStaging()) return null
  return <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-50 h-1 bg-info" />
}

/** Badge « Staging » de la barre supérieure et de la connexion ; rien en production. */
export function EnvBadge({ className }: { className?: string }) {
  if (!isStaging()) return null
  return (
    <span
      title={t.env.stagingDescription}
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-info px-2.5 text-xs font-semibold text-info-foreground',
        className,
      )}
    >
      <FlaskConical aria-hidden className="size-3.5" />
      {t.env.staging}
      <span className="sr-only"> : {t.env.stagingDescription}</span>
    </span>
  )
}
