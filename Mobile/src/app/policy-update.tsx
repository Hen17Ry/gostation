import { useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { Check, LogOut, ShieldCheck } from 'lucide-react-native'
import { useState } from 'react'
import { View } from 'react-native'

import { acceptPrivacyPolicy, logout } from '@/api/account'
import { meKeys } from '@/api/keys'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Screen } from '@/components/ui/screen'
import { Text } from '@/components/ui/text'
import { toast } from '@/components/ui/toast'
import { useMe } from '@/features/auth/use-me'
import { policyState } from '@/features/legal/policy-gate'
import { t } from '@/i18n'
import { errorMessage } from '@/lib/form-errors'
import { haptics } from '@/lib/haptics'
import { useTheme } from '@/theme/theme'

/**
 * Nouvelle politique de confidentialité : à lire et accepter pour continuer à utiliser le compte
 * (seul écran ouvert tant qu'elle n'est pas acceptée). Refus : déconnexion ou suppression du compte.
 */
export default function PolicyUpdate() {
  const qc = useQueryClient()
  const { colors } = useTheme()
  const { me } = useMe()
  const [busy, setBusy] = useState<'accept' | 'logout' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const state = policyState(me)
  const policy = me?.privacyPolicy

  const accept = async () => {
    if (!policy) return
    setBusy('accept')
    setError(null)
    try {
      qc.setQueryData(meKeys.profile(), await acceptPrivacyPolicy(policy.currentVersion))
      haptics.success()
      toast.success(t.privacy.policyAccepted)
    } catch (e) {
      haptics.error()
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }
  const signOut = async () => {
    setBusy('logout')
    try {
      await logout()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Screen
      back={false}
      footer={
        <View className="gap-2">
          <Button
            testID="policy-accept"
            label={t.privacy.policyAccept}
            icon={Check}
            size="lg"
            disabled={state !== 'accept'}
            loading={busy === 'accept'}
            onPress={accept}
          />
          <Button
            testID="policy-sign-out"
            label={t.account.signOut}
            icon={LogOut}
            variant="ghost"
            loading={busy === 'logout'}
            onPress={signOut}
          />
        </View>
      }
    >
      <View className="items-center pt-4" accessibilityElementsHidden>
        <View className="h-16 w-16 items-center justify-center rounded-full bg-primary-subtle">
          <ShieldCheck size={32} color={colors['primary-subtle-foreground']} strokeWidth={2} />
        </View>
      </View>
      <Text variant="title2" accessibilityRole="header" className="text-center">
        {t.privacy.policyTitle}
      </Text>
      {policy && (
        <Text variant="body" tone="muted" className="text-center">
          {t.privacy.policyBody(policy.acceptedVersion, policy.currentVersion)}
        </Text>
      )}
      {state === 'outdated' && <Banner tone="warning">{t.privacy.policyOutdated}</Banner>}
      {error && <Banner tone="danger">{error}</Banner>}
      <View className="items-center gap-1">
        <Button
          testID="policy-read"
          label={t.privacy.policyRead}
          variant="link"
          onPress={() => router.push('/legal/privacy')}
        />
        <Button
          testID="policy-refuse"
          label={t.privacy.policyRefuse}
          variant="link"
          size="sm"
          onPress={() => router.push('/profile/delete')}
        />
      </View>
    </Screen>
  )
}
