import { useNavigate } from '@tanstack/react-router'
import { CalendarRange, ChevronDown } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

import type { PeriodSearch } from './period'

const RangeCalendar = lazy(() => import('./range-calendar'))
const presets = ['24h', '7d', '30d'] as const

function shortRange(from: string, to: string) {
  const f = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  return f.formatRange(new Date(`${from}T00:00:00Z`), new Date(`${to}T00:00:00Z`))
}

/** Sélecteur de période : 24 h, 7 j, 30 j ou plage de dates (dans l'URL : lien profond). */
export function PeriodPicker({ value }: { value: PeriodSearch }) {
  const navigate = useNavigate({ from: '/' })
  const [open, setOpen] = useState(false)
  const custom = value.period === 'custom'
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t.dashboard.period}>
      <ToggleGroup
        type="single"
        variant="segmented"
        spacing={0.5}
        value={custom ? '' : value.period}
        onValueChange={(v) => v && void navigate({ search: { period: v as (typeof presets)[number] } })}
        aria-label={t.dashboard.period}
      >
        {presets.map((p) => (
          <ToggleGroupItem
            key={p}
            value={p}
            className="h-7 min-w-11 px-3 tabular-nums"
            aria-label={`${t.dashboard.periods[p]} · ${t.dashboard.periodLong[p]}`}
          >
            {t.dashboard.periods[p]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={custom}
            className={cn(
              'gap-2',
              custom && 'border-primary/40 bg-primary-subtle text-primary-subtle-foreground hover:bg-primary-subtle',
            )}
          >
            <CalendarRange aria-hidden />
            {custom && value.from && value.to ? shortRange(value.from, value.to) : t.dashboard.periods.custom}
            <ChevronDown aria-hidden className="text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0 pt-1">
          <Suspense fallback={<Skeleton className="m-3 h-72 w-[520px] max-w-[80vw]" />}>
            <RangeCalendar
              from={value.from}
              to={value.to}
              onApply={(from, to) => {
                setOpen(false)
                void navigate({ search: { period: 'custom', from, to } })
              }}
            />
          </Suspense>
        </PopoverContent>
      </Popover>
    </div>
  )
}
