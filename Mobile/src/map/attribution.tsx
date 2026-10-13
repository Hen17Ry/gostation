import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView } from '@gorhom/bottom-sheet'
import * as Linking from 'expo-linking'
import { ExternalLink } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { BackHandler, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { ListRow } from '@/components/ui/list-row'
import { Text } from '@/components/ui/text'
import { t } from '@/i18n'
import { elevation } from '@/theme/elevation'
import { useTheme } from '@/theme/theme'

const SOURCES = [
  { title: t.map.osm, hint: t.map.osmHint, url: 'https://www.openstreetmap.org/copyright' },
  { title: t.map.openFreeMap, hint: t.map.openFreeMapHint, url: 'https://openfreemap.org' },
  { title: t.map.openMapTiles, hint: t.map.openMapTilesHint, url: 'https://www.openmaptiles.org' },
] as const

/**
 * Crédits de la carte, toujours visibles sur la carte (« © OpenStreetMap · OpenFreeMap »), à la
 * place du bouton ⓘ natif de MapLibre (21 dp). Cible de 48 dp de haut autour d'une pastille
 * discrète ; le toucher ouvre les sources et leurs liens.
 */
export function MapAttribution() {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const modal = useRef<BottomSheetModal>(null)
  const [open, setOpen] = useState(false)

  // Bouton retour d'Android : ferme la feuille au lieu de quitter l'écran.
  useEffect(() => {
    if (!open) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      modal.current?.dismiss()
      return true
    })
    return () => sub.remove()
  }, [open])

  return (
    <>
      <Pressable
        testID="map-attribution"
        accessibilityRole="button"
        accessibilityLabel={t.map.attributionLabel}
        onPress={() => modal.current?.present()}
        className="h-12 justify-center self-start"
      >
        <View className="h-7 justify-center rounded-full border border-border bg-popover px-2.5" style={elevation(1)}>
          <Text variant="caption" tone="muted" numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {t.map.attribution}
          </Text>
        </View>
      </Pressable>
      <BottomSheetModal
        ref={modal}
        enableDynamicSizing
        onChange={(index) => setOpen(index >= 0)}
        backgroundStyle={{ backgroundColor: colors.surface, borderRadius: 24 }}
        handleIndicatorStyle={{ backgroundColor: colors['border-strong'], width: 40 }}
        backdropComponent={(p) => (
          <BottomSheetBackdrop {...p} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.4} />
        )}
      >
        <BottomSheetView style={{ paddingBottom: insets.bottom + 16 }}>
          <View className="gap-2 px-5 pb-3 pt-1">
            <Text variant="title3" accessibilityRole="header">
              {t.map.sourcesTitle}
            </Text>
            <Text variant="subhead" tone="muted">
              {t.map.sourcesBody}
            </Text>
          </View>
          {SOURCES.map((s) => (
            <ListRow
              key={s.url}
              title={s.title}
              subtitle={s.hint}
              onPress={() => void Linking.openURL(s.url)}
              trailing={<ExternalLink size={20} color={colors['muted-foreground']} />}
            />
          ))}
        </BottomSheetView>
      </BottomSheetModal>
    </>
  )
}
