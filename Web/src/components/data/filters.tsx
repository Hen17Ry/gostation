import { Check, Search, X } from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ta } from '@/i18n/admin'
import { cn } from '@/lib/utils'

/** Barre de filtres : une rangée au-dessus du tableau, qui passe à la ligne en étroit. */
export function FilterBar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="group" aria-label={ta.common.filters} className={cn('flex flex-wrap items-center gap-2', className)}>
      {children}
    </div>
  )
}

/**
 * Recherche texte : la valeur de l'URL est la source de vérité ; la saisie est envoyée 300 ms
 * après la dernière frappe (Entrée l'envoie tout de suite), Échap efface.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
  className?: string
}) {
  const [draft, setDraft] = useState(value)
  const [synced, setSynced] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  if (synced !== value) {
    setSynced(value)
    setDraft(value)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  function commit(v: string) {
    clearTimeout(timer.current)
    if (v.trim() !== value) onChange(v.trim())
  }

  return (
    <div className={cn('relative w-full sm:w-64', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        role="searchbox"
        aria-label={label}
        placeholder={placeholder}
        value={draft}
        maxLength={100}
        className="pr-8 pl-8 [&::-webkit-search-cancel-button]:hidden"
        onChange={(e) => {
          const v = e.target.value
          setDraft(v)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => commit(v), 300)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(draft)
          if (e.key === 'Escape' && draft) {
            e.preventDefault()
            setDraft('')
            commit('')
          }
        }}
      />
      {draft && (
        <button
          type="button"
          onClick={() => {
            setDraft('')
            commit('')
          }}
          className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={ta.common.clearSearch}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  )
}

/** Liste déroulante de filtre, avec un libellé lu (et visible en préfixe). */
export function FilterSelect<V extends string>({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string
  value: V
  onChange: (value: V) => void
  options: ReadonlyArray<{ value: V; label: string }>
  className?: string
}) {
  const id = useId()
  const active = value !== options[0]?.value
  return (
    <Select value={value} onValueChange={(v) => onChange(v as V)}>
      <SelectTrigger
        aria-labelledby={`${id}-label ${id}-value`}
        size="sm"
        className={cn(
          'h-8 max-w-full min-w-0 gap-1.5 text-xs',
          active && 'border-primary/40 bg-primary-subtle text-primary-subtle-foreground',
          className,
        )}
      >
        <span id={`${id}-label`} className="shrink-0 text-muted-foreground">
          {label} :
        </span>
        <span id={`${id}-value`} className="min-w-0 truncate font-medium">
          <SelectValue />
        </span>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Filtre booléen en pastille (bouton à bascule, aria-pressed). */
export function FilterChip({
  pressed,
  onPressedChange,
  children,
  hint,
}: {
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
  children: ReactNode
  hint?: string
}) {
  const chip = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'h-8 rounded-full px-3 text-xs shadow-none',
        pressed && 'border-primary/40 bg-primary-subtle text-primary-subtle-foreground hover:bg-primary-subtle',
      )}
    >
      {pressed && <Check aria-hidden className="size-3.5" />}
      {children}
    </Button>
  )
  if (!hint) return chip
  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent>{hint}</TooltipContent>
    </Tooltip>
  )
}

/** Onglets de statut segmentés (un seul choix, jamais vide), avec compteur facultatif. */
export function StatusTabs<V extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: V
  onChange: (value: V) => void
  options: ReadonlyArray<{ value: V; label: string; count?: number }>
}) {
  return (
    <ToggleGroup
      type="single"
      variant="segmented"
      spacing={0.5}
      value={value}
      onValueChange={(v) => v && onChange(v as V)}
      aria-label={label}
      className="max-w-full overflow-x-auto"
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className="h-7 gap-1.5 px-3 text-xs">
          {o.label}
          {o.count !== undefined && o.count > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-2xs leading-4 font-semibold text-primary-foreground tabular-nums">
              {o.count}
            </span>
          )}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** « Réinitialiser les filtres », affiché seulement si un filtre est actif. */
export function ResetFilters({ count, onReset }: { count: number; onReset: () => void }) {
  if (count === 0) return null
  return (
    <Button variant="ghost" size="sm" onClick={onReset} className="h-8 text-xs text-muted-foreground">
      <X aria-hidden />
      {ta.common.resetFilters}
      <span className="sr-only"> ({ta.common.activeFilters(count)})</span>
    </Button>
  )
}
