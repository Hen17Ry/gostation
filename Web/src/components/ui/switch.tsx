import { Switch as SwitchPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'

// Interrupteur : piste input (≥ 3:1) au repos, primaire activé ; le curseur glisse en transform.
function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-elevation-1 transition-colors duration-(--duration-fast)',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block size-4 rounded-full bg-white shadow-elevation-1 transition-transform duration-(--duration-fast) ease-(--ease-out) data-[state=checked]:translate-x-[calc(100%+2px)] data-[state=unchecked]:translate-x-0.5"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
