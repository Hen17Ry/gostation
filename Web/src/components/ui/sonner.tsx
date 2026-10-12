import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

import { useTheme } from '@/lib/theme'

// Toasts aux tokens du thème (le thème vient de src/lib/theme.ts, pas de next-themes).
const Toaster = (props: ToasterProps) => {
  const { resolved } = useTheme()
  return (
    <Sonner
      theme={resolved}
      // Sens fixé : sinon sonner lit getComputedStyle à chaque rendu (layout forcé, ~60 ms).
      dir="ltr"
      position="bottom-right"
      closeButton
      className="toaster group"
      containerAriaLabel="Notifications"
      icons={{
        success: <CircleCheckIcon className="size-4 text-success" />,
        info: <InfoIcon className="size-4 text-info" />,
        warning: <TriangleAlertIcon className="size-4 text-warning-subtle-foreground" />,
        error: <OctagonXIcon className="size-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius)',
        } as React.CSSProperties
      }
      toastOptions={{ classNames: { toast: 'shadow-elevation-2 font-sans', description: 'text-muted-foreground' } }}
      {...props}
    />
  )
}

export { Toaster }
