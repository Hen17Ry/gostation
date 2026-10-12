import type { ReactNode } from 'react'

export function StepHeader({ title, subtitle, icon }: { title: string; subtitle?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      {icon && (
        <span className="mb-2 grid size-10 place-items-center rounded-xl bg-primary-subtle text-primary-subtle-foreground ring-1 ring-primary/15">
          {icon}
        </span>
      )}
      <h1 className="text-xl font-semibold tracking-tight text-balance">{title}</h1>
      {subtitle && <p className="text-sm text-pretty text-muted-foreground">{subtitle}</p>}
    </div>
  )
}
