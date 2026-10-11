import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { t } from '@/i18n'

import { EmptyState } from './empty-state'
import { ComingSoonIllustration } from './illustrations'

/** Section prévue dans une prochaine étape : état « à venir » propre. */
export function ComingSoon({ section }: { section: string }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <h1 className="text-xl font-semibold tracking-tight">{section}</h1>
      <Card className="border-dashed shadow-none">
        <EmptyState
          illustration={<ComingSoonIllustration />}
          title={t.comingSoon.title}
          description={t.comingSoon.body(section)}
          action={
            <Button asChild variant="outline" size="sm">
              <Link to="/">
                <ArrowLeft aria-hidden />
                {t.comingSoon.back}
              </Link>
            </Button>
          }
        />
      </Card>
    </div>
  )
}
