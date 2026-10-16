import { router } from 'expo-router'
import { BellRing, CheckCheck, Clock4, type LucideIcon, SearchCheck } from 'lucide-react-native'
import { useState } from 'react'
import { View } from 'react-native'

import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Screen } from '@/components/ui/screen'
import { Text } from '@/components/ui/text'
import { t } from '@/i18n'
import { haptics } from '@/lib/haptics'
import { usePrefs } from '@/stores/prefs'
import { useTheme } from '@/theme/theme'

import { openNotificationSettings, requestPushPermission, usePushPermission } from './permission'

/**
 * Explication des rappels de stock, montrée une fois au gérant juste après la validation de sa
 * station, avant la demande d'autorisation du système (jamais au premier lancement) : pourquoi,
 * quand et à quelle fréquence, comment répondre ou les couper. Android 12 et moins : autorisation
 * déjà accordée, l'écran informe seulement.
 */
export function RemindersIntro() {
  const { colors } = useTheme()
  const { status, canAskAgain } = usePushPermission()
  const setSeen = usePrefs((s) => s.setRemindersIntroSeen)
  const [asking, setAsking] = useState(false)
  const blocked = status === 'denied' && !canAskAgain

  const close = () => {
    setSeen()
    if (router.canGoBack()) router.back()
    else router.replace('/manager/stocks')
  }
  const primary = async () => {
    if (status === 'granted') return close()
    if (blocked) return void openNotificationSettings()
    setAsking(true)
    const result = await requestPushPermission()
    setAsking(false)
    if (result === 'granted') {
      haptics.success()
      close()
    }
  }
  const label =
    status === 'granted' ? t.push.intro.understood : blocked ? t.push.intro.openSettings : t.push.intro.enable

  return (
    <Screen
      back={false}
      footer={
        <View className="gap-2">
          <Button
            label={label}
            size="lg"
            icon={status === 'granted' ? CheckCheck : BellRing}
            loading={asking}
            onPress={primary}
            testID="reminders-intro-primary"
          />
          {status !== 'granted' && (
            <Button label={t.push.intro.later} variant="ghost" onPress={close} testID="reminders-intro-later" />
          )}
        </View>
      }
    >
      <View className="items-start gap-4 pt-6">
        <View
          className="h-16 w-16 items-center justify-center rounded-2xl bg-primary-subtle"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <BellRing size={30} color={colors['primary-subtle-foreground']} strokeWidth={2} />
        </View>
        <Text variant="title1" accessibilityRole="header">
          {t.push.intro.title}
        </Text>
        <Text variant="body" tone="muted">
          {t.push.intro.lead}
        </Text>
      </View>
      <View className="gap-5 pt-2">
        <Reason icon={SearchCheck} title={t.push.intro.whyTitle} body={t.push.intro.why} />
        <Reason icon={Clock4} title={t.push.intro.whenTitle} body={t.push.intro.when} />
        <Reason icon={CheckCheck} title={t.push.intro.quietTitle} body={t.push.intro.quiet} />
      </View>
      {status === 'denied' && <Banner tone="info">{t.push.intro.deniedNote}</Banner>}
    </Screen>
  )
}

function Reason({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body: string }) {
  const { colors } = useTheme()
  return (
    <View className="flex-row gap-4">
      <View
        className="h-11 w-11 items-center justify-center rounded-xl bg-muted"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Icon size={22} color={colors['muted-foreground']} strokeWidth={2} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text variant="headline">{title}</Text>
        <Text variant="subhead" tone="muted">
          {body}
        </Text>
      </View>
    </View>
  )
}
