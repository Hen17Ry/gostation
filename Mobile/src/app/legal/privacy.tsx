import { LegalScreen } from '@/features/legal/legal-screen'
import { t } from '@/i18n'

export default function Privacy() {
  return <LegalScreen title={t.legal.privacyTitle} sections={t.legal.privacy} />
}
