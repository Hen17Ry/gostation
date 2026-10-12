import { router } from 'expo-router'
import { MapPin } from 'lucide-react-native'
import { View } from 'react-native'

import { CoverageIllustration } from '@/components/ui/illustrations'
import { Button } from '@/components/ui/button'
import { Screen } from '@/components/ui/screen'
import { Text } from '@/components/ui/text'
import { useLocation } from '@/features/location/location-store'
import { t } from '@/i18n'

/** Hors zone (422 search.out_of_coverage) : explication, puis choix d'un lieu au Bénin sur la carte. */
export default function OutOfCoverage() {
  return (
    <Screen
      scroll={false}
      footer={
        <Button
          testID="coverage-pick"
          label={t.coverage.pick}
          icon={MapPin}
          size="lg"
          onPress={() => {
            // Mode « point choisi » sans point : la carte invite à toucher un lieu.
            useLocation.setState({ mode: 'manual', manual: null })
            router.back()
          }}
        />
      }
    >
      <View className="flex-1 items-center justify-center gap-6">
        <CoverageIllustration size={200} />
        <View className="gap-2">
          <Text variant="title2" className="text-center" accessibilityRole="header">
            {t.coverage.title}
          </Text>
          <Text variant="body" tone="muted" className="text-center">
            {t.coverage.body}
          </Text>
        </View>
      </View>
    </Screen>
  )
}
