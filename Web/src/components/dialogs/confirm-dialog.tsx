import { type ReactNode, useState } from 'react'

import { isApiError } from '@/api/errors'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { ta } from '@/i18n/admin'

/**
 * Confirmation avant une action sans motif (approbation, désactivation d'un produit…). Le focus
 * part sur « Annuler » ; l'erreur éventuelle s'affiche dans le dialogue.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = false,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel: string
  onConfirm: () => Promise<unknown>
  destructive?: boolean
  children?: ReactNode
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<unknown>(null)

  async function confirm() {
    setPending(true)
    setError(null)
    try {
      await onConfirm()
      setPending(false)
      onOpenChange(false)
    } catch (err) {
      setPending(false)
      setError(err)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return
        if (!next) setError(null)
        onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        {error !== null && (
          <Alert variant="destructive">
            <AlertDescription>{isApiError(error) ? error.userMessage : ta.common.errorAction}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{ta.common.cancel}</AlertDialogCancel>
          {/* Bouton simple (pas AlertDialogAction) : le dialogue reste ouvert pendant la requête. */}
          <Button variant={destructive ? 'destructive' : 'default'} loading={pending} onClick={() => void confirm()}>
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
