import { type FormEvent, type ReactNode, useId, useState } from 'react'

import { isApiError } from '@/api/errors'
import { Field } from '@/components/form/field'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { ta } from '@/i18n/admin'

/**
 * Dialogue de décision avec motif (obligatoire quand l'API l'exige, sinon note facultative).
 * L'erreur de l'API s'affiche dans le dialogue, la saisie est conservée ; le dialogue se ferme
 * seulement si l'action aboutit.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  reasonRequired = true,
  reasonLabel = ta.common.reason,
  reasonHint = ta.common.reasonHint,
  destructive = false,
  maxLength = 500,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  onConfirm: (reason: string) => Promise<unknown>
  reasonRequired?: boolean
  reasonLabel?: string
  reasonHint?: string
  destructive?: boolean
  /** Longueur maximale du motif (500 par défaut, comme les décisions sur les stations). */
  maxLength?: number
  children?: ReactNode
}) {
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const formId = useId()
  const invalid = reasonRequired && reason.trim().length < 3

  function reset(next: boolean) {
    if (pending) return
    if (!next) {
      setReason('')
      setTouched(false)
      setError(null)
    }
    onOpenChange(next)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setTouched(true)
    if (invalid) return
    setPending(true)
    setError(null)
    try {
      await onConfirm(reason.trim())
      setPending(false)
      setReason('')
      setTouched(false)
      onOpenChange(false)
    } catch (err) {
      setPending(false)
      setError(err)
    }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form id={formId} onSubmit={submit} className="flex flex-col gap-4" noValidate>
          {children}
          <Field
            label={reasonRequired ? reasonLabel : `${reasonLabel} (facultatif)`}
            hint={reasonHint}
            error={touched && invalid ? ta.common.reasonRequired : undefined}
            labelAction={
              <span className="text-2xs text-muted-foreground tabular-nums" aria-hidden>
                {ta.common.reasonCounter(reason.length, maxLength)}
              </span>
            }
          >
            {(p) => (
              <Textarea
                {...p}
                value={reason}
                maxLength={maxLength}
                rows={3}
                required={reasonRequired}
                onChange={(e) => setReason(e.target.value)}
                onBlur={() => setTouched(true)}
              />
            )}
          </Field>
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
          <Button type="submit" form={formId} variant={destructive ? 'destructive' : 'default'} loading={pending}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
