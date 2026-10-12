import { View } from 'react-native'

import { Banner } from '@/components/ui/banner'
import { Screen } from '@/components/ui/screen'
import { Text } from '@/components/ui/text'
import { t } from '@/i18n'

/** Texte légal provisoire, marqué comme tel (texte final validé à l'étape 10). */
export function LegalScreen({
  title,
  sections,
}: {
  title: string
  sections: readonly { heading: string; body: string }[]
}) {
  return (
    <Screen title={title}>
      <Banner tone="warning" title={t.legal.draft}>
        {t.legal.draftBody}
      </Banner>
      {sections.map((s) => (
        <View key={s.heading} className="gap-1.5">
          <Text variant="headline" accessibilityRole="header">
            {s.heading}
          </Text>
          <Text variant="body" tone="muted">
            {s.body}
          </Text>
        </View>
      ))}
    </Screen>
  )
}
