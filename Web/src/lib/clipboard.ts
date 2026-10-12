import { toast } from 'sonner'

import { ta } from '@/i18n/admin'

/** Copie un texte dans le presse-papiers, avec un toast (succès ou échec). */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(ta.common.copied)
  } catch {
    toast.error(ta.common.errorAction)
  }
}
