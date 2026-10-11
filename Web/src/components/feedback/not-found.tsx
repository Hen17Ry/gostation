import { Link } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { t } from '@/i18n'

import { EmptyState } from './empty-state'
import { NotFoundIllustration } from './illustrations'

export function NotFound() {
  return (
    <main className="grid min-h-[60vh] place-items-center p-6">
      <EmptyState
        headingLevel={1}
        illustration={<NotFoundIllustration />}
        title={t.errors.notFoundTitle}
        description={t.errors.notFoundBody}
        action={
          <Button asChild variant="outline" size="sm">
            <Link to="/">{t.errors.home}</Link>
          </Button>
        }
      />
    </main>
  )
}
