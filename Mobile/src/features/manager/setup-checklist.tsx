import { type Href, router } from 'expo-router'
import { ChevronRight, CircleCheck, Circle } from 'lucide-react-native'
import { Pressable, View } from 'react-native'

import type { StationSetup } from '@/api/schemas'
import { Card } from '@/components/ui/card'
import { Text } from '@/components/ui/text'
import { t } from '@/i18n'
import { useTheme } from '@/theme/theme'

const STEPS: { key: 'location' | 'openingHours' | 'products' | 'stocks'; label: string; href: Href | null }[] = [
  { key: 'location', label: t.manager.setup.location, href: '/manager/location' },
  { key: 'openingHours', label: t.manager.setup.openingHours, href: '/manager/hours' },
  { key: 'products', label: t.manager.setup.products, href: '/manager/products' },
  // Les stocks se saisissent sur l'écran d'accueil, juste en dessous.
  { key: 'stocks', label: t.manager.setup.stock, href: null },
]

/**
 * Première configuration (D63) : ce qui manque pour apparaître dans la recherche, tiré de l'objet
 * `setup` de l'API. Chaque étape restante mène à son écran.
 */
export function SetupChecklist({ setup }: { setup: StationSetup }) {
  const { colors } = useTheme()
  const done = STEPS.filter((s) => setup[s.key]).length
  return (
    <Card flush testID="setup-checklist" className="overflow-hidden">
      <View className="flex-row items-center justify-between gap-3 px-4 pb-2 pt-4">
        <Text variant="headline" accessibilityRole="header" className="flex-1">
          {t.manager.setup.title}
        </Text>
        <Text variant="subhead" weight="semibold" tone="brand">
          {t.manager.setup.progress(done, STEPS.length)}
        </Text>
      </View>
      <View className="mx-4 mb-2 h-1.5 overflow-hidden rounded-full bg-secondary" importantForAccessibility="no">
        <View className="h-full rounded-full bg-primary" style={{ width: `${(done / STEPS.length) * 100}%` }} />
      </View>
      {STEPS.map((s) => {
        const ok = setup[s.key]
        const Icon = ok ? CircleCheck : Circle
        const content = (
          <View className="min-h-14 flex-row items-center gap-3 px-4 py-2">
            <Icon size={22} color={ok ? colors.success : colors['muted-foreground']} strokeWidth={2.2} />
            <Text variant="body" weight={ok ? 'regular' : 'medium'} tone={ok ? 'muted' : 'default'} className="flex-1">
              {s.label}
            </Text>
            {!ok && s.href && <ChevronRight size={20} color={colors['muted-foreground']} />}
          </View>
        )
        if (ok || !s.href)
          return (
            <View
              key={s.key}
              accessible
              accessibilityLabel={`${s.label}, ${ok ? t.manager.setup.doneItem : t.manager.setup.todoItem}`}
            >
              {content}
            </View>
          )
        const href = s.href
        return (
          <Pressable
            key={s.key}
            testID={`setup-${s.key}`}
            accessibilityRole="button"
            accessibilityLabel={s.label}
            onPress={() => router.push(href)}
            android_ripple={{ color: colors.accent }}
          >
            {content}
          </Pressable>
        )
      })}
    </Card>
  )
}
