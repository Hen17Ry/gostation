import { format, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale/fr'
import { useState } from 'react'
import type { DateRange } from 'react-day-picker'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { t } from '@/i18n'
import { toLocalDate } from '@/lib/format'

import { isValidRange } from './period'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')

/** Choix d'une plage de dates (366 jours au plus, jusqu'à aujourd'hui). Chargé à l'ouverture. */
export default function RangeCalendar({
  from,
  to,
  onApply,
}: {
  from?: string
  to?: string
  onApply: (from: string, to: string) => void
}) {
  const today = toLocalDate(new Date())
  const [range, setRange] = useState<DateRange | undefined>(
    from && to ? { from: parseISO(from), to: parseISO(to) } : undefined,
  )
  const valid = Boolean(range?.from && range.to && isValidRange(iso(range.from), iso(range.to), today))
  return (
    <div className="flex flex-col gap-3">
      <Calendar
        mode="range"
        locale={fr}
        selected={range}
        onSelect={setRange}
        numberOfMonths={2}
        defaultMonth={range?.from ?? new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)}
        disabled={{ after: parseISO(today) }}
        weekStartsOn={1}
      />
      <div className="flex items-center justify-between gap-3 border-t px-3 pt-3 pb-1">
        <p className="text-2xs text-muted-foreground">{t.dashboard.rangeHint}</p>
        <Button
          size="sm"
          disabled={!valid}
          onClick={() => range?.from && range.to && onApply(iso(range.from), iso(range.to))}
        >
          {t.dashboard.applyRange}
        </Button>
      </div>
    </div>
  )
}
