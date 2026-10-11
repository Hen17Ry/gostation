import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { Toggle as TogglePrimitive } from 'radix-ui'

// Bascule : état actif teinté de la marque ; variante « segmented » = contrôle segmenté (piste
// atténuée, segment actif surélevé), utilisée pour la période et la vue graphique / tableau.
const toggleVariants = cva(
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-[color,background-color,box-shadow] duration-(--duration-fast) outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-primary-subtle data-[state=on]:text-primary-subtle-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-input bg-transparent shadow-elevation-1',
        segmented:
          'text-muted-foreground hover:bg-transparent data-[state=on]:bg-surface data-[state=on]:text-foreground data-[state=on]:shadow-elevation-1',
      },
      size: {
        default: 'h-9 min-w-9 px-2',
        sm: 'h-7 min-w-7 px-1.5 text-xs',
        lg: 'h-10 min-w-10 px-2.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root data-slot="toggle" className={cn(toggleVariants({ variant, size, className }))} {...props} />
  )
}

export { Toggle, toggleVariants }
