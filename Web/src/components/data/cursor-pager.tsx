import { ChevronLeft, ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ta } from '@/i18n/admin'

/** Précédent / Suivant d'une liste paginée par curseur. */
export function CursorPager({
  page,
  hasPrevious,
  nextCursor,
  onPrevious,
  onNext,
  summary,
}: {
  page: number
  hasPrevious: boolean
  nextCursor: string | null | undefined
  onPrevious: () => void
  onNext: (cursor: string) => void
  summary?: string
}) {
  if (!hasPrevious && !nextCursor && !summary) return null
  return (
    <nav aria-label={ta.common.pagination} className="flex items-center justify-between gap-3 px-1 text-xs">
      <span className="text-muted-foreground tabular-nums" aria-live="polite">
        {summary ?? ta.common.page(page)}
      </span>
      {(hasPrevious || nextCursor) && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onPrevious} disabled={!hasPrevious}>
            <ChevronLeft aria-hidden />
            {ta.common.previous}
          </Button>
          <Button variant="outline" size="sm" onClick={() => nextCursor && onNext(nextCursor)} disabled={!nextCursor}>
            {ta.common.next}
            <ChevronRight aria-hidden />
          </Button>
        </div>
      )}
    </nav>
  )
}
