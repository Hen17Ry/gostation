import { privacyPolicy } from '@/features/legal/content.generated'
import { LegalScreen } from '@/features/legal/legal-screen'

export default function Privacy() {
  return <LegalScreen doc={privacyPolicy} />
}
