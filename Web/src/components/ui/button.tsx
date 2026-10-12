import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { Slot } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

// Base shadcn/ui, harmonisée avec les tokens : couleurs sémantiques, anneau de focus 2 px décalé
// (contraste ≥ 3:1), retour d'appui par transform (60 fps), aucune transition de layout.
const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap select-none',
    'transition-[color,background-color,border-color,box-shadow,transform] duration-(--duration-fast) ease-(--ease-out) active:scale-[0.98]',
    'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    'disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        // Désactivé (hors chargement) : neutre plutôt qu'un orange délavé, lisible dans les deux thèmes.
        default:
          'bg-primary text-primary-foreground shadow-elevation-1 hover:bg-primary-hover disabled:not-aria-busy:bg-muted disabled:not-aria-busy:text-muted-foreground disabled:not-aria-busy:opacity-100 disabled:not-aria-busy:shadow-none',
        destructive: 'bg-destructive text-destructive-foreground shadow-elevation-1 hover:bg-destructive/90',
        outline: 'border border-border-strong bg-surface text-foreground shadow-elevation-1 hover:bg-accent',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-accent',
        ghost: 'text-foreground hover:bg-accent hover:text-accent-foreground',
        link: 'h-auto px-0 text-brand-text underline-offset-4 hover:underline active:scale-100',
      },
      size: {
        default: 'h-9 px-4 has-[>svg]:px-3',
        xs: "h-7 gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: 'h-8 gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-10 px-5 text-sm has-[>svg]:px-4',
        icon: 'size-9',
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    /** Affiche un indicateur, bloque le bouton et l'annonce comme occupé. */
    loading?: boolean
  }

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={asChild ? undefined : disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading && <Loader2 className="animate-spin" aria-hidden />}
          {children}
        </>
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
