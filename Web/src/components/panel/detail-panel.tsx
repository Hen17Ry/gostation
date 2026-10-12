import { X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { type ReactNode, useRef } from 'react'

import { ta } from '@/i18n/admin'
import { cn } from '@/lib/utils'

/**
 * Panneau latéral de détail (fiche d'un signalement, d'un compte, d'une entrée d'audit, d'une
 * station sur la carte). Dialogue Radix : focus déplacé puis rendu à l'élément d'origine, Échap
 * ferme. Modal par défaut (focus piégé, fond assombri) ; `modal={false}` sur une carte, qui reste
 * utilisable à côté (choisir une autre station met le panneau à jour). Entrée en transform
 * (glissement + fondu), coupée si mouvement réduit.
 */
export function DetailPanel({
  open,
  onOpenChange,
  title,
  description,
  badges,
  actions,
  footer,
  children,
  className,
  modal = true,
}: {
  modal?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  badges?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <DialogPrimitive.Portal>
        {modal && (
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 motion-reduce:animate-none" />
        )}
        <DialogPrimitive.Content
          // Non modal : un clic à côté (sur la carte) ne ferme pas le panneau.
          onInteractOutside={modal ? undefined : (e) => e.preventDefault()}
          // Focus sur le contenu du panneau (lu avec son titre), pas sur « Fermer ».
          onOpenAutoFocus={(e) => {
            e.preventDefault()
            bodyRef.current?.focus()
          }}
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-popover text-popover-foreground shadow-elevation-3 outline-none sm:max-w-[30rem]',
            'data-[state=closed]:animate-out data-[state=closed]:duration-(--duration-base) data-[state=closed]:ease-(--ease-in) data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-right-8',
            'data-[state=open]:animate-in data-[state=open]:duration-(--duration-slow) data-[state=open]:ease-(--ease-out) data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right-8',
            'motion-reduce:animate-none',
            className,
          )}
        >
          <header className="flex shrink-0 items-start gap-3 border-b px-5 py-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {badges && <div className="flex flex-wrap items-center gap-1.5">{badges}</div>}
              <DialogPrimitive.Title className="text-base leading-tight font-semibold text-balance">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="text-xs text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{ta.common.details}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close
              className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={ta.common.close}
            >
              <X className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          </header>
          {actions && <div className="flex shrink-0 flex-wrap gap-2 border-b px-5 py-3">{actions}</div>}
          <div ref={bodyRef} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto px-5 py-4 outline-none">
            {children}
          </div>
          {footer && <footer className="flex shrink-0 flex-wrap justify-end gap-2 border-t px-5 py-3">{footer}</footer>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

/** Section d'un panneau : titre discret puis contenu. */
export function PanelSection({
  title,
  children,
  className,
}: {
  title: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('flex flex-col gap-2 border-b py-4 first:pt-0 last:border-b-0 last:pb-0', className)}>
      <h3 className="text-2xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}
