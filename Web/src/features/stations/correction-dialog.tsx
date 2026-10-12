import { useQueryClient } from '@tanstack/react-query'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { toast } from 'sonner'

import { correctStation, stationQuery, type StationCorrection } from '@/api/admin'
import type { Station } from '@/api/admin-schemas'
import { isApiError } from '@/api/errors'
import { counterKeys, stationKeys } from '@/api/keys'
import { Field } from '@/components/form/field'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
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
import { Textarea } from '@/components/ui/textarea'
import { ta } from '@/i18n/admin'
import { cn } from '@/lib/utils'

const FIELDS = ['name', 'brand', 'address', 'city', 'phone', 'ifu', 'rccm'] as const
type FieldName = (typeof FIELDS)[number]
type Values = Record<FieldName, string>

const valuesOf = (s: Station): Values => ({
  name: s.name,
  brand: s.brand ?? '',
  address: s.address,
  city: s.city ?? '',
  phone: s.phone,
  ifu: s.ifu,
  rccm: s.rccm,
})

function validate(v: Values): Partial<Record<FieldName, string>> {
  const e: Partial<Record<FieldName, string>> = {}
  const len = (x: string) => x.trim().length
  if (len(v.name) < 2 || len(v.name) > 120) e.name = ta.station.validation.name
  if (len(v.address) < 5 || len(v.address) > 255) e.address = ta.station.validation.address
  if (!/^\d{13}$/.test(v.ifu.trim())) e.ifu = ta.station.validation.ifu
  if (len(v.rccm) === 0) e.rccm = ta.station.validation.rccm
  if (!/^\+\d{8,15}$/.test(v.phone.trim())) e.phone = ta.station.validation.phone
  if (len(v.brand) > 60) e.brand = ta.station.validation.brand
  if (len(v.city) > 100) e.city = ta.station.validation.city
  return e
}

interface Conflict {
  latest: Station
  changed: FieldName[]
  statusChanged: boolean
}

/**
 * Correction des informations d'une station (motif obligatoire, If-Match). Seuls les champs
 * modifiés sont envoyés. En cas de 412, la dernière version est lue et comparée à celle de
 * l'ouverture : l'admin voit ce qui a changé, garde sa saisie, recharge (les champs qu'il n'a pas
 * touchés prennent la nouvelle valeur) puis enregistre à nouveau.
 */
export function CorrectionDialog({
  open,
  onOpenChange,
  station,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  station: Station
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        {open && <CorrectionForm station={station} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function CorrectionForm({ station, onDone }: { station: Station; onDone: () => void }) {
  const qc = useQueryClient()
  const formId = useId()
  const [base, setBase] = useState<Station>(station)
  const [values, setValues] = useState<Values>(() => valuesOf(station))
  const [reason, setReason] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)

  const baseValues = valuesOf(base)
  const dirty = FIELDS.filter((f) => values[f].trim() !== baseValues[f])
  const errors = validate(values)
  const reasonInvalid = reason.trim().length < 3
  const identityChange = dirty.includes('ifu') || dirty.includes('rccm')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitted(true)
    if (Object.keys(errors).length > 0 || reasonInvalid || dirty.length === 0) return
    const body: StationCorrection = { reason: reason.trim() }
    for (const f of dirty) body[f] = values[f].trim()
    setPending(true)
    setError(null)
    try {
      const updated = await correctStation(base.id, base.version, body)
      qc.setQueryData(stationQuery(base.id).queryKey, updated)
      void qc.invalidateQueries({ queryKey: stationKeys.lists() })
      void qc.invalidateQueries({ queryKey: stationKeys.timeline(base.id) })
      void qc.invalidateQueries({ queryKey: counterKeys.all })
      toast.success(ta.station.correction.done, { description: ta.station.emailSent })
      onDone()
    } catch (err) {
      if (isApiError(err) && (err.status === 412 || err.code === 'resource.version_conflict')) {
        const latest = await qc.fetchQuery({ ...stationQuery(base.id), staleTime: 0 })
        const now = valuesOf(latest)
        setConflict({
          latest,
          changed: FIELDS.filter((f) => now[f] !== baseValues[f]),
          statusChanged: latest.status !== base.status,
        })
      } else {
        setError(err)
      }
    } finally {
      setPending(false)
    }
  }

  /** Recharge : nouvelle version de référence ; la saisie de l'admin est conservée. */
  function reload() {
    if (!conflict) return
    const now = valuesOf(conflict.latest)
    setValues((v) => {
      const next = { ...v }
      for (const f of FIELDS) if (v[f].trim() === baseValues[f]) next[f] = now[f]
      return next
    })
    setBase(conflict.latest)
    setConflict(null)
    toast.info(ta.station.correction.reloaded)
  }

  const label = (f: FieldName) => ta.station.fields[f]!
  return (
    <>
      <DialogHeader>
        <DialogTitle>{ta.station.correction.title}</DialogTitle>
        <DialogDescription>{ta.station.correction.body}</DialogDescription>
      </DialogHeader>

      {conflict && (
        <Alert variant="warning" className="flex flex-col gap-3" data-testid="correction-conflict">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="flex flex-col gap-1">
              <AlertTitle>{ta.station.correction.conflictTitle}</AlertTitle>
              <AlertDescription>{ta.station.correction.conflictBody}</AlertDescription>
            </div>
          </div>
          {conflict.statusChanged && (
            <p className="text-xs font-medium">
              {ta.station.correction.conflictStatus(
                ta.station.statuses[base.status]!,
                ta.station.statuses[conflict.latest.status]!,
              )}
            </p>
          )}
          {conflict.changed.length > 0 ? (
            <div className="overflow-x-auto rounded-md border border-warning/40 bg-card text-foreground">
              <table className="w-full text-xs">
                <caption className="sr-only">{ta.station.correction.conflictTitle}</caption>
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th scope="col" className="px-2 py-1.5 text-left font-medium">
                      {ta.station.correction.conflictField}
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-left font-medium">
                      {ta.station.correction.conflictBefore}
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-left font-medium">
                      {ta.station.correction.conflictNow}
                    </th>
                    <th scope="col" className="px-2 py-1.5 text-left font-medium">
                      {ta.station.correction.conflictYours}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {conflict.changed.map((f) => (
                    <tr key={f} className="border-b last:border-0">
                      <th scope="row" className="px-2 py-1.5 text-left font-medium">
                        {label(f)}
                      </th>
                      <td className="px-2 py-1.5 text-muted-foreground line-through">
                        {baseValues[f] || ta.common.none}
                      </td>
                      <td className="px-2 py-1.5 font-medium">{valuesOf(conflict.latest)[f] || ta.common.none}</td>
                      <td className="px-2 py-1.5">
                        {values[f].trim() === baseValues[f] ? (
                          <span className="text-muted-foreground italic">{ta.station.correction.untouched}</span>
                        ) : (
                          values[f] || ta.common.none
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs">{ta.station.correction.conflictNoField}</p>
          )}
          <Button size="sm" variant="outline" className="self-start" onClick={reload}>
            <RefreshCw aria-hidden />
            {ta.station.correction.reload}
          </Button>
        </Alert>
      )}

      <form id={formId} onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <Field
            key={f}
            label={label(f)}
            error={submitted ? errors[f] : undefined}
            className={cn(f === 'address' && 'sm:col-span-2')}
          >
            {(p) => (
              <Input
                {...p}
                value={values[f]}
                onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
                inputMode={f === 'ifu' ? 'numeric' : f === 'phone' ? 'tel' : undefined}
                autoComplete="off"
                className={cn(
                  (f === 'ifu' || f === 'rccm') && 'font-mono',
                  values[f].trim() !== baseValues[f] && 'border-primary/60 bg-primary-subtle/30',
                )}
              />
            )}
          </Field>
        ))}
        {identityChange && (
          <p className="rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning-subtle-foreground sm:col-span-2">
            {ta.station.correction.identityWarning}
          </p>
        )}
        <Field
          label={ta.station.correction.reason}
          hint={ta.common.reasonHint}
          error={submitted && reasonInvalid ? ta.common.reasonRequired : undefined}
          className="sm:col-span-2"
        >
          {(p) => (
            <Textarea {...p} value={reason} maxLength={500} rows={2} onChange={(e) => setReason(e.target.value)} />
          )}
        </Field>
        {submitted && dirty.length === 0 && (
          <p role="alert" className="text-xs font-medium text-destructive sm:col-span-2">
            {ta.station.correction.noChange}
          </p>
        )}
        {error !== null && (
          <Alert variant="destructive" className="sm:col-span-2">
            <AlertDescription>{isApiError(error) ? error.userMessage : ta.common.errorAction}</AlertDescription>
          </Alert>
        )}
      </form>
      <DialogFooter>
        <Button variant="outline" onClick={onDone} disabled={pending}>
          {ta.common.cancel}
        </Button>
        <Button type="submit" form={formId} loading={pending} disabled={conflict !== null}>
          {ta.station.correction.submit}
        </Button>
      </DialogFooter>
    </>
  )
}
