import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

// Statuts : fond teinté + texte foncé (≥ 4,5:1), toujours accompagnés d'un libellé.
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-2xs font-medium whitespace-nowrap tabular-nums [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        brand: 'bg-primary-subtle text-primary-subtle-foreground',
        secondary: 'bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        success: 'bg-success-subtle text-success-subtle-foreground',
        warning: 'bg-warning-subtle text-warning-subtle-foreground',
        danger: 'bg-danger-subtle text-danger-subtle-foreground',
        info: 'bg-info-subtle text-info-subtle-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span'
  return (
    <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
