import { type ColumnVisibilityState as VisibilityState, type RowData, useTable } from '@tanstack/react-table'
import { type LucideIcon, MoreHorizontal, SlidersHorizontal } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import { ErrorState } from '@/components/feedback/error-state'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { ta } from '@/i18n/admin'
import { cn } from '@/lib/utils'

import { type DataColumn, dataTableFeatures } from './table-features'

/** Action du menu d'une ligne (bloc « Complex Data Table » de 21st.dev). */
export interface RowAction {
  label: string
  icon?: LucideIcon
  onSelect: () => void
  destructive?: boolean
}

function loadVisibility(key?: string): VisibilityState {
  if (!key) return {}
  try {
    return JSON.parse(localStorage.getItem(`gs-cols:${key}`) ?? '{}') as VisibilityState
  } catch {
    return {}
  }
}

/**
 * Tableau de données (TanStack Table v9, rendu shadcn) : pagination serveur gérée par l'écran,
 * colonnes masquables (choix mémorisé par tableau), squelettes au chargement, états vide et
 * d'erreur, ligne sélectionnée. Clic n'importe où sur une ligne pour l'ouvrir ; au clavier, la
 * première cellule porte le lien ou le bouton d'ouverture (`data-open-row`).
 */
export function DataTable<T extends RowData>({
  columns,
  data,
  getRowId,
  caption,
  isLoading,
  isFetching,
  error,
  onRetry,
  empty,
  onRowClick,
  selectedId,
  storageKey,
  toolbar,
  footer,
  skeletonRows = 8,
  rowActions,
  rowLabel,
}: {
  columns: ReadonlyArray<DataColumn<T>>
  data: T[]
  getRowId: (row: T) => string
  caption: string
  isLoading?: boolean
  isFetching?: boolean
  error?: unknown
  onRetry?: () => void
  empty?: ReactNode
  onRowClick?: (row: T) => void
  selectedId?: string
  storageKey?: string
  toolbar?: ReactNode
  footer?: ReactNode
  skeletonRows?: number
  /** Menu « … » en fin de ligne (copier un identifiant, ouvrir sur la carte…). */
  rowActions?: (row: T) => RowAction[]
  /** Nom de la ligne pour le libellé accessible du menu. */
  rowLabel?: (row: T) => string
}) {
  'use no memo' // lectures internes de la table (visibilité) invisibles du React Compiler
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => loadVisibility(storageKey))
  const table = useTable({
    features: dataTableFeatures,
    columns: columns as DataColumn<T>[],
    data,
    getRowId: (row) => getRowId(row),
    state: { columnVisibility },
    onColumnVisibilityChange: (updater) => {
      setColumnVisibility((prev: VisibilityState) => {
        const next = typeof updater === 'function' ? updater(prev) : updater
        if (storageKey) {
          try {
            localStorage.setItem(`gs-cols:${storageKey}`, JSON.stringify(next))
          } catch {
            // Stockage indisponible : le choix vaut pour la session.
          }
        }
        return next
      })
    },
  })
  const hideable = table.getAllLeafColumns().filter((c) => c.columnDef.meta?.hideable !== false)
  const visibleCount = table.getVisibleLeafColumns().length + (rowActions ? 1 : 0)
  const rows = table.getRowModel().rows
  const showSkeleton = isLoading && rows.length === 0

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {(toolbar || hideable.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{toolbar}</div>
          {hideable.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs">
                  <SlidersHorizontal aria-hidden />
                  {ta.common.columns}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-xs">{ta.common.columnsLabel}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {hideable.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c.id}
                    checked={c.getIsVisible()}
                    onCheckedChange={(v) => c.toggleVisibility(!!v)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {c.columnDef.meta?.label ?? (typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id)}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      <div
        className={cn(
          'relative overflow-hidden rounded-xl border bg-card shadow-elevation-1 transition-opacity duration-(--duration-base)',
          isFetching && !showSkeleton && 'opacity-70',
        )}
        aria-busy={isLoading || isFetching || undefined}
      >
        {error && rows.length === 0 ? (
          <ErrorState error={error} onRetry={onRetry} size="sm" />
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full caption-bottom text-sm">
              <caption className="sr-only">{caption}</caption>
              <thead className="border-b bg-surface-sunken/60">
                {table.getHeaderGroups().map((group) => (
                  <tr key={group.id}>
                    {group.headers.map((header) => (
                      <th
                        key={header.id}
                        scope="col"
                        className={cn(
                          'h-9 px-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground first:pl-4 last:pr-4',
                          header.column.columnDef.meta?.headerClassName ?? header.column.columnDef.meta?.className,
                        )}
                      >
                        {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                      </th>
                    ))}
                    {rowActions && (
                      <th scope="col" className="w-12 pr-4">
                        <span className="sr-only">{ta.common.rowActions}</span>
                      </th>
                    )}
                  </tr>
                ))}
              </thead>
              <tbody>
                {showSkeleton ? (
                  Array.from({ length: skeletonRows }, (_, i) => (
                    <tr key={i} className="border-b last:border-0" aria-hidden>
                      {Array.from({ length: visibleCount }, (_, j) => (
                        <td key={j} className="h-12 px-3 first:pl-4 last:pr-4">
                          <Skeleton className={cn('h-4', j === 0 ? 'w-40' : 'w-20')} />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={visibleCount}>{empty}</td>
                  </tr>
                ) : (
                  rows.map((row) => {
                    const selected = selectedId !== undefined && row.id === selectedId
                    return (
                      <tr
                        key={row.id}
                        data-state={selected ? 'selected' : undefined}
                        aria-selected={onRowClick ? selected : undefined}
                        onClick={
                          onRowClick
                            ? (e) => {
                                // Les contrôles de la ligne (liens, boutons, menus) gardent leur action, sauf
                                // le bouton d'ouverture de la ligne (data-open-row, accès clavier).
                                const target = e.target as HTMLElement
                                if (
                                  target.closest('a,button,input,[role="menuitem"]') &&
                                  !target.closest('[data-open-row]')
                                )
                                  return
                                onRowClick(row.original)
                              }
                            : undefined
                        }
                        className={cn(
                          'border-b transition-colors duration-(--duration-fast) last:border-0 hover:bg-muted/50',
                          onRowClick && 'cursor-pointer',
                          selected && 'bg-primary-subtle/60 hover:bg-primary-subtle/80',
                        )}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td
                            key={cell.id}
                            className={cn(
                              'h-12 px-3 align-middle first:pl-4 last:pr-4',
                              cell.column.columnDef.meta?.className,
                            )}
                          >
                            <table.FlexRender cell={cell} />
                          </td>
                        ))}
                        {rowActions && (
                          <td className="h-12 w-12 pr-3 text-right">
                            <RowMenu actions={rowActions(row.original)} label={rowLabel?.(row.original)} />
                          </td>
                        )}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
            {showSkeleton && <span className="sr-only">{ta.common.loadingRows}</span>}
          </div>
        )}
      </div>
      {footer}
    </div>
  )
}

function RowMenu({ actions, label }: { actions: RowAction[]; label?: string }) {
  if (actions.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={ta.common.rowActionsFor(label)}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {actions.map(({ label: l, icon: Icon, onSelect, destructive }) => (
          <DropdownMenuItem key={l} onSelect={onSelect} variant={destructive ? 'destructive' : undefined}>
            {Icon && <Icon aria-hidden />}
            {l}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
