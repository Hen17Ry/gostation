import { Banner } from '@/components/ui/banner'
import { t } from '@/i18n'

import { pushSupported } from './availability'

/**
 * Téléphone sans Google Play Services : aucun push possible (FCM). Compte, réglages des
 * notifications et favoris avec alerte : ce que l'on manque et où retrouver les notifications.
 */
export function PushUnavailableBanner({ className, body }: { className?: string; body?: string }) {
  if (pushSupported()) return null
  return (
    <Banner tone="info" className={className} title={t.push.unavailable.title}>
      {body ?? t.push.unavailable.body}
    </Banner>
  )
}
