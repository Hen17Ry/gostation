import { router } from 'expo-router'
import { X } from 'lucide-react-native'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { IconButton } from '@/components/ui/icon-button'
import { MapHome } from '@/features/search/map-home'
import { t } from '@/i18n'

/** Recherche ouverte au gérant (D58) : la même carte que l'espace utilisateur, en plein écran. */
export default function ManagerSearch() {
  const insets = useSafeAreaInsets()
  return (
    <View className="flex-1">
      <MapHome />
      <View pointerEvents="box-none" className="absolute right-4" style={{ top: insets.top + 8 }}>
        <IconButton floating icon={X} label={t.common.close} onPress={() => router.back()} />
      </View>
    </View>
  )
}
