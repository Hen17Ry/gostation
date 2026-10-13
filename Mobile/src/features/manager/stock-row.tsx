import { CircleSlash, Clock3, EyeOff } from 'lucide-react-native'
import { memo, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'

import type { Stock } from '@/api/schemas'
import { Badge } from '@/components/ui/badge'
import { Stepper } from '@/components/ui/stepper'
import { Text } from '@/components/ui/text'
import { t } from '@/i18n'
import { cn } from '@/lib/cn'
import { agoFrom, formatInteger, formatQuantity } from '@/lib/format'
import { haptics } from '@/lib/haptics'
import { useTheme } from '@/theme/theme'

/**
 * Ligne de la saisie des stocks : produit, fraîcheur (« mis à jour il y a », badge à vérifier ou
 * invisible), bouton « Rupture », puis compteur (bouteilles) ou pavé numérique (litres).
 */
export const StockRow = memo(function StockRow({
  item,
  value,
  onChange,
}: {
  item: Stock
  value: number
  onChange: (productId: number, quantity: number) => void
}) {
  const { colors } = useTheme()
  const changed = value !== item.quantity
  const set = (q: number) => onChange(item.productId, q)
  const id = `stock-${item.code}`

  return (
    <View
      testID={id}
      className={cn('gap-3 rounded-xl border bg-card p-4', changed ? 'border-primary' : 'border-border')}
    >
      <View className="flex-row items-start gap-3">
        <View className="flex-1 gap-1">
          <Text variant="headline">{item.label}</Text>
          <View className="flex-row flex-wrap items-center gap-1.5">
            <Text variant="caption" tone="muted">
              {t.manager.stocks.updated(agoFrom(item.freshAt))}
            </Text>
            {item.freshness === 'stale' && <Badge label={t.manager.stocks.stale} tone="warning" icon={Clock3} />}
            {item.freshness === 'expired' && <Badge label={t.manager.stocks.expired} tone="danger" icon={EyeOff} />}
          </View>
        </View>
        <Pressable
          testID={`${id}-out`}
          accessibilityRole="button"
          accessibilityLabel={t.manager.stocks.outOfStockLabel(item.label)}
          accessibilityState={{ disabled: value === 0 }}
          disabled={value === 0}
          onPress={() => {
            haptics.selection()
            set(0)
          }}
          hitSlop={4}
          android_ripple={{ color: colors.accent, foreground: true }}
          className={cn(
            'h-10 flex-row items-center gap-1.5 overflow-hidden rounded-full border px-3',
            value === 0 ? 'border-border bg-secondary opacity-60' : 'border-border-strong bg-surface',
          )}
        >
          <CircleSlash size={16} color={colors['danger-subtle-foreground']} strokeWidth={2.2} />
          <Text variant="subhead" weight="semibold">
            {t.manager.stocks.outOfStock}
          </Text>
        </Pressable>
      </View>

      {item.unit === 'cylinder' ? (
        <Stepper
          testID={`${id}-qty`}
          value={value}
          max={item.maxQuantity}
          onChange={set}
          changed={changed}
          label={t.manager.stocks.quantityLabel(item.label)}
          valueText={formatQuantity('cylinder', value)}
          decreaseLabel={t.manager.stocks.decrease(item.label)}
          increaseLabel={t.manager.stocks.increase(item.label)}
        />
      ) : (
        <LitersInput
          testID={`${id}-qty`}
          value={value}
          max={item.maxQuantity}
          onChange={set}
          changed={changed}
          label={t.manager.stocks.quantityLabel(item.label)}
        />
      )}
    </View>
  )
})

/**
 * Litres au pavé numérique, séparateurs de milliers pendant la saisie, plafond de l'API. Toute
 * la ligne est la cible ; le champ prend le focus au toucher.
 */
function LitersInput({
  value,
  max,
  onChange,
  changed,
  label,
  testID,
}: {
  value: number
  max: number
  onChange: (v: number) => void
  changed: boolean
  label: string
  testID?: string
}) {
  const { colors } = useTheme()
  const [focused, setFocused] = useState(false)
  return (
    <View
      className={cn(
        'h-14 flex-row items-center gap-2 rounded-lg border-2 px-4',
        focused ? 'border-ring' : changed ? 'border-primary bg-primary-subtle' : 'border-transparent bg-secondary',
      )}
    >
      <TextInput
        testID={testID}
        accessibilityLabel={label}
        accessibilityHint={t.manager.stocks.max(formatInteger(max))}
        value={formatInteger(value)}
        onChangeText={(text) => {
          const digits = text.replace(/\D/g, '')
          onChange(Math.min(max, digits === '' ? 0 : Number(digits)))
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        returnKeyType="done"
        selectTextOnFocus
        maxFontSizeMultiplier={1.6}
        className="h-14 flex-1"
        style={{ color: colors.foreground, fontFamily: 'GeistMono_500Medium', fontSize: 24 }}
      />
      <Text variant="headline" tone="muted">
        {t.manager.stocks.liters}
      </Text>
    </View>
  )
}
