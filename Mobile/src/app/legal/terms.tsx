import { terms } from '@/features/legal/content.generated'
import { LegalScreen } from '@/features/legal/legal-screen'

export default function Terms() {
  return <LegalScreen doc={terms} />
}
