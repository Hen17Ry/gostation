import {
  type Announcements,
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Flame, Fuel, GripVertical, Pencil, Plus } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { toast } from 'sonner'

import { createProduct, productsQuery, updateProduct } from '@/api/admin'
import type { Product } from '@/api/admin-schemas'
import { isApiError } from '@/api/errors'
import { productKeys } from '@/api/keys'
import { PageHeader } from '@/components/data/page-header'
import { ConfirmDialog } from '@/components/dialogs/confirm-dialog'
import { EmptyState } from '@/components/feedback/empty-state'
import { ErrorState } from '@/components/feedback/error-state'
import { EmptyListIllustration } from '@/components/feedback/illustrations'
import { Field } from '@/components/form/field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ta } from '@/i18n/admin'
import { cn } from '@/lib/utils'

import { reorder } from './reorder'

const EMPTY: Product[] = []

export function CatalogPage() {
  const qc = useQueryClient()
  const q = useQuery(productsQuery)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [toggling, setToggling] = useState<Product | null>(null)
  const items = q.data?.items ?? EMPTY
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const instructionsId = useId()

  const position = (id: string | number) => items.findIndex((p) => p.id === Number(id)) + 1
  const labelOf = (id: string | number) => items.find((p) => p.id === Number(id))?.label ?? ''
  const announcements: Announcements = {
    onDragStart: ({ active }) => ta.catalog.grabbed(labelOf(active.id), position(active.id), items.length),
    // Au départ, l'élément est « au-dessus » de lui-même : on garde l'annonce de prise en main.
    onDragOver: ({ active, over }) =>
      over && over.id !== active.id ? ta.catalog.moved(labelOf(active.id), position(over.id), items.length) : undefined,
    onDragEnd: ({ active, over }) => (over ? ta.catalog.dropped(labelOf(active.id), position(over.id)) : undefined),
    onDragCancel: ({ active }) => ta.catalog.cancelled(labelOf(active.id)),
  }

  /** Déplacement optimiste (sans risque : l'ordre n'affecte que l'affichage) ; annulé si l'API refuse. */
  async function move(from: number, to: number) {
    if (from === to || to < 0 || to >= items.length) return
    const previous = q.data
    const { list, writes } = reorder(items, from, to)
    qc.setQueryData(productsQuery.queryKey, (d) => (d ? { ...d, items: list } : d))
    try {
      for (const p of writes) await updateProduct(p.id, { sortOrder: p.sortOrder })
      toast.success(ta.catalog.reordered)
    } catch (e) {
      qc.setQueryData(productsQuery.queryKey, previous)
      toast.error(ta.common.errorAction, { description: isApiError(e) ? e.userMessage : undefined })
    } finally {
      void qc.invalidateQueries({ queryKey: productKeys.all })
    }
  }

  function onDragEnd(e: DragEndEvent) {
    if (!e.over) return
    void move(position(e.active.id) - 1, position(e.over.id) - 1)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={ta.catalog.title}
        description={ta.catalog.subtitle}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden />
            {ta.catalog.add}
          </Button>
        }
      />
      <div className="overflow-hidden rounded-xl border bg-card shadow-elevation-1">
        {q.isPending ? (
          <div className="flex flex-col gap-px" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 rounded-none" />
            ))}
          </div>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} size="sm" />
        ) : items.length === 0 ? (
          <EmptyState illustration={<EmptyListIllustration />} title={ta.catalog.empty} />
        ) : (
          <>
            <p id={instructionsId} className="sr-only">
              {ta.catalog.dragInstructions}
            </p>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
              onDragEnd={onDragEnd}
              accessibility={{ announcements, screenReaderInstructions: { draggable: ta.catalog.dragInstructions } }}
            >
              <SortableContext items={items.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                <ul aria-label={ta.catalog.listLabel} className="flex flex-col divide-y">
                  {items.map((p, i) => (
                    <ProductRow
                      key={p.id}
                      p={p}
                      index={i}
                      count={items.length}
                      describedBy={instructionsId}
                      onMove={(to) => void move(i, to)}
                      onEdit={() => setEditing(p)}
                      onToggle={() => setToggling(p)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          </>
        )}
      </div>
      <CreateProductDialog open={creating} onOpenChange={setCreating} />
      <EditLabelDialog product={editing} onClose={() => setEditing(null)} />
      {toggling && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setToggling(null)}
          title={
            toggling.active ? ta.catalog.deactivateTitle(toggling.label) : ta.catalog.activateTitle(toggling.label)
          }
          description={
            <>
              <strong className="font-semibold text-foreground">{ta.catalog.impact(toggling.stations)}</strong>{' '}
              {toggling.active ? ta.catalog.deactivateBody : ta.catalog.activateBody}
            </>
          }
          confirmLabel={toggling.active ? ta.catalog.deactivate : ta.catalog.activate}
          destructive={toggling.active}
          onConfirm={async () => {
            const updated = await updateProduct(toggling.id, { active: !toggling.active })
            qc.setQueryData(productsQuery.queryKey, (d) =>
              d ? { ...d, items: d.items.map((x) => (x.id === updated.id ? updated : x)) } : d,
            )
            void qc.invalidateQueries({ queryKey: productKeys.all })
            toast.success(updated.active ? ta.catalog.activated : ta.catalog.deactivated)
          }}
        />
      )}
    </div>
  )
}

function ProductRow({
  p,
  index,
  count,
  describedBy,
  onMove,
  onEdit,
  onToggle,
}: {
  p: Product
  index: number
  count: number
  describedBy: string
  onMove: (to: number) => void
  onEdit: () => void
  onToggle: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: p.id,
  })
  const Icon = p.kind === 'lpg' ? Flame : Fuel
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        'group relative flex items-center gap-3 bg-card px-3 py-3 sm:px-4',
        isDragging && 'z-10 rounded-lg shadow-elevation-3 ring-1 ring-primary/40',
        !p.active && 'bg-surface-sunken/50',
      )}
      data-testid={`product-${p.code}`}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        {...attributes}
        {...listeners}
        aria-describedby={describedBy}
        aria-label={ta.catalog.dragHandle(p.label)}
        className="grid size-9 shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      >
        <GripVertical className="size-4" aria-hidden />
      </button>
      <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums" aria-hidden>
        {index + 1}
      </span>
      <span
        className={cn(
          'grid size-9 shrink-0 place-items-center rounded-lg',
          p.active ? 'bg-primary-subtle text-primary-subtle-foreground' : 'bg-muted text-muted-foreground',
        )}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate font-medium', !p.active && 'text-muted-foreground')}>{p.label}</span>
        <span className="truncate text-2xs text-muted-foreground">
          {ta.catalog.kinds[p.kind]} · {ta.catalog.units[p.unit]} · <span className="font-mono">{p.code}</span>
        </span>
      </div>
      <Badge variant="secondary" className="hidden sm:inline-flex">
        {ta.catalog.stations(p.stations)}
      </Badge>
      <div className="flex items-center gap-0.5">
        <RowIconButton label={ta.catalog.moveUp} onClick={() => onMove(index - 1)} disabled={index === 0}>
          <ChevronUp />
        </RowIconButton>
        <RowIconButton label={ta.catalog.moveDown} onClick={() => onMove(index + 1)} disabled={index === count - 1}>
          <ChevronDown />
        </RowIconButton>
        <RowIconButton label={ta.catalog.edit} onClick={onEdit}>
          <Pencil />
        </RowIconButton>
      </div>
      <div className="flex w-28 items-center justify-end gap-2">
        <Label htmlFor={`active-${p.id}`} className="text-xs font-normal text-muted-foreground">
          {p.active ? ta.catalog.active : ta.catalog.inactive}
        </Label>
        <Switch
          id={`active-${p.id}`}
          checked={p.active}
          onCheckedChange={onToggle}
          aria-label={ta.catalog.toggleLabel(p.label)}
        />
      </div>
    </li>
  )
}

function RowIconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={label} onClick={onClick} disabled={disabled}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function CreateProductDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const qc = useQueryClient()
  const formId = useId()
  const [kind, setKind] = useState<Product['kind']>('lpg')
  const [size, setSize] = useState('')
  const [label, setLabel] = useState('')
  const [active, setActive] = useState(true)
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const sizeKg = Number(size.replace(',', '.'))
  const sizeInvalid =
    kind === 'lpg' &&
    (!Number.isFinite(sizeKg) || sizeKg < 0.5 || sizeKg > 100 || Math.round(sizeKg * 100) !== sizeKg * 100)
  const labelInvalid = label.trim().length < 2 || label.trim().length > 60

  function reset(o: boolean) {
    if (pending) return
    if (!o) {
      setKind('lpg')
      setSize('')
      setLabel('')
      setActive(true)
      setSubmitted(false)
      setError(null)
    }
    onOpenChange(o)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (sizeInvalid || labelInvalid) return
    setPending(true)
    setError(null)
    try {
      await createProduct({ kind, label: label.trim(), active, ...(kind === 'lpg' ? { sizeKg } : {}) })
      void qc.invalidateQueries({ queryKey: productKeys.all })
      toast.success(ta.catalog.created)
      setPending(false)
      reset(false)
    } catch (err) {
      setPending(false)
      setError(err)
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ta.catalog.add}</DialogTitle>
          <DialogDescription>{ta.catalog.sizeHint}</DialogDescription>
        </DialogHeader>
        <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field label={ta.catalog.kind}>
            {(p) => (
              <Select value={kind} onValueChange={(v) => setKind(v as Product['kind'])}>
                <SelectTrigger id={p.id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(['lpg', 'petrol', 'diesel'] as const).map((k) => (
                    <SelectItem key={k} value={k}>
                      {ta.catalog.kinds[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          {kind === 'lpg' && (
            <Field label={ta.catalog.size} error={submitted && sizeInvalid ? ta.catalog.validation.size : undefined}>
              {(p) => (
                <Input
                  {...p}
                  inputMode="decimal"
                  value={size}
                  onChange={(e) => setSize(e.target.value)}
                  placeholder="12,5"
                />
              )}
            </Field>
          )}
          <Field
            label={ta.catalog.label}
            hint={ta.catalog.labelHint}
            error={submitted && labelInvalid ? ta.catalog.validation.label : undefined}
          >
            {(p) => <Input {...p} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />}
          </Field>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`${formId}-active`}>{ta.catalog.activeNow}</Label>
            <Switch id={`${formId}-active`} checked={active} onCheckedChange={setActive} />
          </div>
          {error !== null && (
            <Alert variant="destructive">
              <AlertDescription>{isApiError(error) ? error.userMessage : ta.common.errorAction}</AlertDescription>
            </Alert>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => reset(false)} disabled={pending}>
            {ta.common.cancel}
          </Button>
          <Button type="submit" form={formId} loading={pending}>
            {ta.catalog.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditLabelDialog({ product, onClose }: { product: Product | null; onClose: () => void }) {
  return (
    <Dialog open={product !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        {product && <EditLabelForm product={product} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

function EditLabelForm({ product, onClose }: { product: Product; onClose: () => void }) {
  const qc = useQueryClient()
  const formId = useId()
  const [label, setLabel] = useState(product.label)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const invalid = label.trim().length < 2 || label.trim().length > 60

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (invalid) return
    if (label.trim() === product.label) return onClose()
    setPending(true)
    try {
      const updated = await updateProduct(product.id, { label: label.trim() })
      qc.setQueryData(productsQuery.queryKey, (d) =>
        d ? { ...d, items: d.items.map((x) => (x.id === updated.id ? updated : x)) } : d,
      )
      void qc.invalidateQueries({ queryKey: productKeys.all })
      toast.success(ta.catalog.updated)
      onClose()
    } catch (err) {
      setError(err)
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{ta.catalog.editTitle}</DialogTitle>
        <DialogDescription>
          <span className="font-mono">{product.code}</span>
        </DialogDescription>
      </DialogHeader>
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field
          label={ta.catalog.label}
          hint={ta.catalog.labelHint}
          error={invalid ? ta.catalog.validation.label : undefined}
        >
          {(p) => <Input {...p} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />}
        </Field>
        {error !== null && (
          <Alert variant="destructive">
            <AlertDescription>{isApiError(error) ? error.userMessage : ta.common.errorAction}</AlertDescription>
          </Alert>
        )}
      </form>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={pending}>
          {ta.common.cancel}
        </Button>
        <Button type="submit" form={formId} loading={pending}>
          {ta.common.save}
        </Button>
      </DialogFooter>
    </>
  )
}
