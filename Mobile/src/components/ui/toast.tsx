import { CircleAlert, CircleCheck, Info } from 'lucide-react-native'
import { useEffect } from 'react'
import { AccessibilityInfo, View } from 'react-native'
import { FadeInDown, FadeOutUp } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { create } from 'zustand'

import { AnimatedView } from '@/lib/animated'
import { elevation } from '@/theme/elevation'
import { useTheme } from '@/theme/theme'

import { Text } from './text'

type Tone = 'success' | 'info' | 'danger'
interface Toast {
  id: number
  message: string
  tone: Tone
}

const useToasts = create<{ items: Toast[]; push: (t: Omit<Toast, 'id'>) => void; drop: (id: number) => void }>(
  (set) => ({
    items: [],
    push: (t) => set((s) => ({ items: [...s.items.slice(-1), { ...t, id: Date.now() + Math.random() }] })),
    drop: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
  }),
)

/** Confirmation brève (favori ajouté, signalement envoyé…), annoncée aux lecteurs d'écran. */
export const toast = {
  success: (message: string) => useToasts.getState().push({ message, tone: 'success' }),
  info: (message: string) => useToasts.getState().push({ message, tone: 'info' }),
  error: (message: string) => useToasts.getState().push({ message, tone: 'danger' }),
}

const ICON = { success: CircleCheck, info: Info, danger: CircleAlert }

/**
 * Hôte des toasts, en haut de l'écran (sous la barre d'état) : ne masque jamais un panneau, un pied
 * d'écran ni le bouton principal ; 3,5 s chacun.
 */
export function ToastHost() {
  const items = useToasts((s) => s.items)
  const insets = useSafeAreaInsets()
  return (
    <View pointerEvents="box-none" className="absolute inset-x-0 items-center px-4" style={{ top: insets.top + 8 }}>
      {items.map((t) => (
        <ToastView key={t.id} toast={t} />
      ))}
    </View>
  )
}

function ToastView({ toast: item }: { toast: Toast }) {
  const { colors } = useTheme()
  const drop = useToasts((s) => s.drop)
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(item.message)
    const id = setTimeout(() => drop(item.id), 3500)
    return () => clearTimeout(id)
  }, [item, drop])
  const Icon = ICON[item.tone]
  const color = item.tone === 'success' ? colors.success : item.tone === 'danger' ? colors.destructive : colors.info
  return (
    <AnimatedView
      entering={FadeInDown.duration(200)}
      exiting={FadeOutUp.duration(150)}
      className="mt-2 w-full max-w-[420px] flex-row items-center gap-3 rounded-xl border border-border bg-popover px-4 py-3"
      style={elevation(3)}
    >
      <Icon size={20} color={color} strokeWidth={2.2} />
      <Text variant="subhead" weight="medium" className="flex-1">
        {item.message}
      </Text>
    </AnimatedView>
  )
}
