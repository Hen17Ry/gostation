import { useQueryClient } from '@tanstack/react-query'
import { useLocalSearchParams } from 'expo-router'
import { MailCheck } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { View } from 'react-native'

import { resendVerification, verifyEmail } from '@/api/account'
import { isApiError } from '@/api/errors'
import { meKeys } from '@/api/keys'
import type { Profile } from '@/api/schemas'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { OtpInput } from '@/components/ui/otp-input'
import { Screen } from '@/components/ui/screen'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import { haptics } from '@/lib/haptics'
import { useLeaveAuth } from '@/lib/navigation'
import { useTheme } from '@/theme/theme'

const RESEND_DELAY_S = 60

/**
 * Code à 6 chiffres reçu par email : saisie automatique (one-time-code), envoi dès le 6ᵉ chiffre,
 * renvoi possible après 60 s (réponse générique côté API).
 */
export default function Verify() {
  const leave = useLeaveAuth()
  const { email = '' } = useLocalSearchParams<{ email?: string }>()
  const qc = useQueryClient()
  const { colors } = useTheme()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(RESEND_DELAY_S)

  useEffect(() => {
    if (wait <= 0) return
    const id = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(id)
  }, [wait])

  const submit = async (value = code) => {
    if (value.length !== 6 || busy) return
    setBusy(true)
    setError(undefined)
    try {
      await verifyEmail(email, value)
      haptics.success()
      await qc.invalidateQueries({ queryKey: meKeys.all })
      toast.success(t.auth.verified)
      leave(qc.getQueryData<Profile>(meKeys.profile()))
    } catch (e) {
      haptics.error()
      setCode('')
      setError(isApiError(e) ? e.userMessage : t.common.errorTitle)
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    try {
      await resendVerification(email)
      setWait(RESEND_DELAY_S)
      toast.info(t.auth.resent)
    } catch (e) {
      toast.error(isApiError(e) ? e.userMessage : t.common.errorTitle)
    }
  }

  return (
    <Screen
      title={t.auth.verifyTitle}
      subtitle={t.auth.verifySubtitle(email)}
      footer={
        <View className="gap-2">
          <Button
            testID="verify-submit"
            label={t.common.confirm}
            size="lg"
            loading={busy}
            disabled={code.length !== 6}
            onPress={() => submit()}
          />
          <Button
            label={t.auth.later}
            variant="ghost"
            onPress={() => leave(qc.getQueryData<Profile>(meKeys.profile()))}
          />
        </View>
      }
    >
      <View className="items-center py-2">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-primary-subtle">
          <MailCheck size={30} color={colors['primary-subtle-foreground']} />
        </View>
      </View>
      <OtpInput label={t.auth.code} value={code} onChange={setCode} onComplete={submit} error={error} />
      <Button
        testID="verify-resend"
        label={wait > 0 ? t.auth.resendIn(wait) : t.auth.resend}
        variant="ghost"
        size="sm"
        disabled={wait > 0}
        className="self-center"
        onPress={resend}
      />
      {!email && <Banner tone="warning">{t.validation.email}</Banner>}
    </Screen>
  )
}
