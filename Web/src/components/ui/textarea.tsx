import * as React from 'react'

import { cn } from '@/lib/utils'

// Même contour et même focus que Input (contour ≥ 3:1, anneau de focus visible).
function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-20 w-full rounded-md border border-input bg-surface px-3 py-2 text-base text-foreground shadow-elevation-1 transition-[border-color,box-shadow] duration-(--duration-fast) outline-none md:text-sm',
        'placeholder:text-muted-foreground hover:border-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30',
        'disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60',
        'aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
