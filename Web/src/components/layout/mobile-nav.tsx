import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { t } from '@/i18n'

import { SidebarContent } from './app-sidebar'

/** Navigation en tiroir sous 768 px. */
export function MobileNav({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[272px] gap-0 bg-sidebar p-0 sm:max-w-[272px]">
        <SheetHeader className="sr-only">
          <SheetTitle>{t.nav.label}</SheetTitle>
          <SheetDescription>{t.app.name}</SheetDescription>
        </SheetHeader>
        <SidebarContent collapsed={false} onNavigate={() => onOpenChange(false)} />
      </SheetContent>
    </Sheet>
  )
}
