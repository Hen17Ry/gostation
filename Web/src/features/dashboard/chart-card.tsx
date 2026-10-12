import { BarChart3, Table2 } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { t } from '@/i18n'
import { cn } from '@/lib/utils'

export interface DataTable {
  caption: string
  columns: { key: string; label: string; numeric?: boolean }[]
  rows: Record<string, ReactNode>[]
}

/*
 * Carte de graphique, d'après le « ChartCard » de 21st.dev (uvain) : titre, résumé textuel lu
 * avant le graphique, et une vue tableau. Le tableau existe toujours pour les lecteurs d'écran ;
 * la bascule « Tableau » le rend visible (contraste de certaines séries < 3:1 : la vue tableau
 * est la compensation exigée par la palette validée).
 */
export function ChartCard({
  title,
  description,
  summary,
  table,
  className,
  children,
  footer,
}: {
  title: string
  description?: string
  /** Résumé textuel du graphique (lecteurs d'écran). */
  summary: string
  table?: DataTable
  className?: string
  children: ReactNode
  footer?: ReactNode
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const summaryId = useId()
  return (
    <Card className={cn('min-w-0', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {table && (
          <CardAction>
            <ToggleGroup
              type="single"
              size="sm"
              variant="segmented"
              spacing={0.5}
              value={view}
              onValueChange={(v) => v && setView(v as 'chart' | 'table')}
              aria-label={t.dashboard.view}
            >
              <ToggleGroupItem value="chart" aria-label={t.dashboard.viewChart} className="px-2">
                <BarChart3 aria-hidden />
              </ToggleGroupItem>
              <ToggleGroupItem value="table" aria-label={t.dashboard.viewTable} className="px-2">
                <Table2 aria-hidden />
              </ToggleGroupItem>
            </ToggleGroup>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-3">
        <p id={summaryId} className="sr-only">
          {summary}
        </p>
        {view === 'chart' ? (
          <>
            <figure aria-label={title} aria-describedby={summaryId} className="m-0 min-w-0">
              {children}
            </figure>
            {table && <DataTableView table={table} className="sr-only" />}
          </>
        ) : (
          table && <DataTableView table={table} className="max-h-[296px] overflow-auto rounded-md border" />
        )}
        {footer}
      </CardContent>
    </Card>
  )
}

function DataTableView({ table, className }: { table: DataTable; className?: string }) {
  return (
    <div className={className}>
      <Table>
        <caption className="sr-only">{table.caption}</caption>
        <TableHeader className="sticky top-0 bg-card">
          <TableRow>
            {table.columns.map((c) => (
              <TableHead key={c.key} scope="col" className={cn('h-8 text-2xs', c.numeric && 'text-right')}>
                {c.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {table.rows.map((row, i) => (
            <TableRow key={i}>
              {table.columns.map((c, j) =>
                j === 0 ? (
                  <TableHead key={c.key} scope="row" className="h-8 py-1 text-xs font-normal text-foreground">
                    {row[c.key]}
                  </TableHead>
                ) : (
                  <TableCell key={c.key} className={cn('py-1 text-xs', c.numeric && 'text-right tabular-nums')}>
                    {row[c.key]}
                  </TableCell>
                ),
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/** Légende : toujours présente dès deux séries ; le texte reste dans les couleurs de texte. */
export function Legend({ items }: { items: { key: string; label: string; color: string; icon?: ReactNode }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5" aria-hidden>
      {items.map((it) => (
        <li key={it.key} className="flex items-center gap-1.5 text-2xs text-muted-foreground">
          {it.icon ?? <span className="size-2.5 rounded-[3px]" style={{ background: it.color }} />}
          {it.label}
        </li>
      ))}
    </ul>
  )
}
