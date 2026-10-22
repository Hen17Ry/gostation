import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n'

import { pushSupported } from './availability'
import { openNotificationSettings, usePushPermission } from './permission'
import { PushUnavailableBanner } from './push-unavailable-banner'

/**
 * Bandeau discret quand les notifications sont refusées : ce que l'on manque, et un lien vers les
 * réglages de l'app (le système ne redemandera pas). Gérant : écran Stocks ; utilisateur : favoris
 * avec au moins une alerte. Téléphone sans services Google : l'utilisateur est prévenu que ses
 * alertes arrivent dans l'app ; le gérant a le rappel de l'écran Stocks.
 */
export function PushDeniedBanner({ audience, className }: { audience: 'manager' | 'user'; className?: string }) {
  const denied = usePushPermission((s) => s.status === 'denied')
  if (!pushSupported()) return audience === 'user' ? <PushUnavailableBanner className={className} /> : null
  if (!denied) return null
  return (
    <Banner
      tone="info"
      className={className}
      title={t.push.denied.title}
      action={<Button label={t.push.denied.action} size="sm" variant="outline" onPress={openNotificationSettings} />}
    >
      {audience === 'manager' ? t.push.denied.manager : t.push.denied.user}
    </Banner>
  )
}
