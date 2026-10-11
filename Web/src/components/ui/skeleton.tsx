import { cn } from '@/lib/utils'

/** Squelette de chargement : reflet animé en transform (60 fps), figé si mouvement réduit. */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn(
        'relative overflow-hidden rounded-md bg-muted',
        'before:absolute before:inset-0 before:animate-shimmer before:bg-linear-to-r before:from-transparent before:via-foreground/6 before:to-transparent',
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
