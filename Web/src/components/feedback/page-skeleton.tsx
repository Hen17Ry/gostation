import { Skeleton } from '@/components/ui/skeleton'
import { t } from '@/i18n'

/** Squelette générique d'une page pendant le chargement d'une route. */
export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-6" role="status" aria-label={t.app.loading}>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  )
}
