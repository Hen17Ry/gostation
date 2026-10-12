import { LegalScreen } from '@/features/legal/legal-screen'
import { t } from '@/i18n'

export default function Terms() {
  return <LegalScreen title={t.legal.termsTitle} sections={t.legal.terms} />
}
