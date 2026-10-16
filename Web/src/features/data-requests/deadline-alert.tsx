import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Clock } from 'lucide-react'

import { countersQuery } from '@/api/counters'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * Alerte d'échéance des demandes de données : demandes en retard ou à échéance sous 7 jours
 * (compteurs de la barre latérale). Rien n'est affiché tant qu'aucune n'est concernée.
 */
export function DataRequestsDueAlert({ className, link = true }: { className?: string; link?: boolean }) {
  const { data } = useQuery({ ...countersQuery, select: (c) => c.dataRequests })
  if (!data || data.overdue + data.dueSoon === 0) return null
  return (
    <Alert variant={data.overdue > 0 ? 'destructive' : 'warning'} className={cn(className)}>
      <Clock aria-hidden />
      <AlertTitle>{t.dashboard.dataRequestsDue(data.overdue, data.dueSoon)}</AlertTitle>
      <AlertDescription>
        <p>
          {t.dashboard.dataRequestsDueBody}{' '}
          {link && (
            <Link
              to="/data-requests"
              search={data.overdue > 0 ? { overdue: true } : {}}
              className="font-medium underline underline-offset-4"
            >
              {t.dashboard.dataRequestsDueLink}
            </Link>
          )}
        </p>
      </AlertDescription>
    </Alert>
  )
}
