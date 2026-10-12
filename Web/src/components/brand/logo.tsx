import { cn } from '@/lib/utils'

/** Marque GoStation : épingle de station + éclair (énergie), sur pastille orange. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-8 shrink-0', className)} aria-hidden>
      <rect width="32" height="32" rx="8" className="fill-primary" />
      <path
        d="M16 6.5c-4 0-7.2 3.1-7.2 7 0 5.1 6.1 10.9 6.6 11.4a.9.9 0 0 0 1.2 0c.5-.5 6.6-6.3 6.6-11.4 0-3.9-3.2-7-7.2-7Z"
        className="fill-primary-foreground"
      />
      <path d="M16.9 9.6l-3.2 4.6h2.4l-.9 3.9 3.3-4.9h-2.5l.9-3.6Z" className="fill-primary" />
    </svg>
  )
}

export function Logo({ className, textClassName }: { className?: string; textClassName?: string }) {
  return (
    <span className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <LogoMark />
      <span className={cn('flex min-w-0 flex-col gap-0.5 leading-none', textClassName)}>
        <span className="truncate text-sm font-semibold tracking-tight">GoStation</span>
        <span className="truncate text-2xs text-muted-foreground">Administration</span>
      </span>
    </span>
  )
}
