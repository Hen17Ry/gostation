import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker'
import { CalendarDays, Clock } from 'lucide-react-native'
import { useState } from 'react'
import { Platform, Pressable, View } from 'react-native'

import { cn } from '@/lib/cn'
import { useTheme } from '@/theme/theme'

import { Text } from './text'

const pad = (n: number) => String(n).padStart(2, '0')
/** « 06:30 » ↔ Date du jour (heure locale du téléphone ; seule l'heure compte). */
const toDate = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date()
  d.setHours(h === 24 ? 0 : (h ?? 0), m ?? 0, 0, 0)
  return d
}
const toHHMM = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/**
 * Heure (HH:MM, 24 h) par le sélecteur natif : boîte de dialogue sur Android, sélecteur compact
 * sur iOS. Cible de 48 dp, libellé visible lu avec la valeur.
 */
export function TimeField({
  label,
  value,
  onChange,
  testID,
  className,
}: {
  label: string
  value: string
  onChange: (hhmm: string) => void
  testID?: string
  className?: string
}) {
  const { colors } = useTheme()
  const [iosOpen, setIosOpen] = useState(false)
  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: toDate(value),
        mode: 'time',
        is24Hour: true,
        onChange: (e: DateTimePickerEvent, d?: Date) => {
          if (e.type === 'set' && d) onChange(toHHMM(d))
        },
      })
    } else setIosOpen((o) => !o)
  }
  return (
    <View className={cn('gap-1', className)}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label} : ${value}`}
        onPress={open}
        className="h-12 flex-row items-center gap-2 rounded-lg border border-input bg-surface px-3"
      >
        <Clock size={16} color={colors['muted-foreground']} />
        <View className="flex-1">
          <Text variant="caption" tone="muted">
            {label}
          </Text>
          <Text variant="body" mono weight="medium">
            {value}
          </Text>
        </View>
      </Pressable>
      {iosOpen && Platform.OS === 'ios' && (
        <DateTimePicker
          value={toDate(value)}
          mode="time"
          display="spinner"
          onChange={(_e, d) => d && onChange(toHHMM(d))}
        />
      )}
    </View>
  )
}

const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Date (AAAA-MM-JJ) par le sélecteur natif, bornée entre `min` et `max`. */
export function DateField({
  label,
  value,
  display,
  onChange,
  min,
  max,
  testID,
}: {
  label: string
  value: string
  /** Date affichée (« mardi 14 octobre »). */
  display: string
  onChange: (iso: string) => void
  min: Date
  max: Date
  testID?: string
}) {
  const { colors } = useTheme()
  const [iosOpen, setIosOpen] = useState(false)
  const current = new Date(`${value}T12:00:00`)
  const open = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: current,
        mode: 'date',
        minimumDate: min,
        maximumDate: max,
        onChange: (e: DateTimePickerEvent, d?: Date) => {
          if (e.type === 'set' && d) onChange(isoDay(d))
        },
      })
    } else setIosOpen((o) => !o)
  }
  return (
    <View className="gap-1">
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${label} : ${display}`}
        onPress={open}
        className="h-12 flex-row items-center gap-2 rounded-lg border border-input bg-surface px-3"
      >
        <CalendarDays size={16} color={colors['muted-foreground']} />
        <View className="flex-1">
          <Text variant="caption" tone="muted">
            {label}
          </Text>
          <Text variant="body" weight="medium">
            {display}
          </Text>
        </View>
      </Pressable>
      {iosOpen && Platform.OS === 'ios' && (
        <DateTimePicker
          value={current}
          mode="date"
          display="inline"
          minimumDate={min}
          maximumDate={max}
          onChange={(_e, d) => d && onChange(isoDay(d))}
        />
      )}
    </View>
  )
}
