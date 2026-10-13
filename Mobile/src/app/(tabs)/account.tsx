import Constants from 'expo-constants'
import { router } from 'expo-router'
import {
  BellRing,
  FileText,
  KeyRound,
  LogOut,
  MailWarning,
  Palette,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRound,
  UserPlus,
  LogIn,
} from 'lucide-react-native'
import { useState } from 'react'
import { ScrollView, View } from 'react-native'

import { logout } from '@/api/account'
import { LogoMark } from '@/components/brand/logo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Divider } from '@/components/ui/divider'
import { ListRow, SwitchRow } from '@/components/ui/list-row'
import { Section } from '@/components/ui/section'
import { Skeleton } from '@/components/ui/skeleton'
import { TabScreen } from '@/components/ui/tab-screen'
import { Text } from '@/components/ui/text'
import { toast } from '@/components/ui/toast'
import { useMe } from '@/features/auth/use-me'
import { t } from '@/i18n'
import { haptics } from '@/lib/haptics'
import { usePrefs } from '@/stores/prefs'

/** Compte : invitation sans compte, ou profil, sécurité, notifications, préférences, légal. */
export default function Account() {
  const { me, signedIn, isPending } = useMe()
  const voice = usePrefs((s) => s.voice)
  const setVoice = usePrefs((s) => s.setVoice)
  const [leaving, setLeaving] = useState(false)

  const signOut = async () => {
    setLeaving(true)
    try {
      await logout()
      haptics.success()
      toast.info(t.account.signedOut)
    } finally {
      setLeaving(false)
    }
  }

  return (
    <TabScreen title={t.account.title}>
      {/* Recréée à la connexion et à la déconnexion : le défilement de l'autre état ne cache pas
          le haut du nouveau (profil, ou invitation à se connecter). */}
      <ScrollView key={signedIn ? 'in' : 'out'} contentContainerClassName="gap-6 px-5 pb-10 pt-1">
        {!signedIn ? (
          <Card className="gap-4">
            <View className="flex-row items-center gap-3">
              <LogoMark size={44} />
              <Text variant="headline" className="flex-1">
                {t.account.guestTitle}
              </Text>
            </View>
            <Text variant="subhead" tone="muted">
              {t.account.guestBody}
            </Text>
            <View className="gap-2">
              <Button
                testID="account-sign-up"
                label={t.auth.signUp}
                icon={UserPlus}
                onPress={() => router.push('/auth/sign-up')}
              />
              <Button
                testID="account-sign-in"
                label={t.auth.signIn}
                icon={LogIn}
                variant="outline"
                onPress={() => router.push('/auth/sign-in')}
              />
            </View>
            <Button
              testID="account-sign-up-manager"
              label={t.manager.signUpLink}
              variant="link"
              size="sm"
              onPress={() => router.push('/auth/sign-up-manager')}
            />
          </Card>
        ) : !me ? (
          <Skeleton height={96} className="rounded-xl" />
        ) : (
          <Card className="gap-3">
            <View className="flex-row items-center gap-3">
              <View
                className="h-14 w-14 items-center justify-center rounded-full bg-primary-subtle"
                accessibilityElementsHidden
              >
                <Text variant="title3" tone="onPrimarySubtle">
                  {`${me.firstName[0] ?? ''}${me.lastName[0] ?? ''}`.toUpperCase()}
                </Text>
              </View>
              <View className="flex-1 gap-0.5">
                <Text variant="headline" numberOfLines={1}>
                  {`${me.firstName} ${me.lastName}`}
                </Text>
                <Text variant="footnote" tone="muted" numberOfLines={1}>
                  {me.email}
                </Text>
              </View>
            </View>
            {!me.emailVerified && (
              <View className="flex-row items-center justify-between gap-2">
                <Badge label={t.account.emailNotVerified} tone="warning" icon={MailWarning} />
                <Button
                  label={t.auth.verifyNow}
                  size="sm"
                  variant="outline"
                  onPress={() => router.push({ pathname: '/auth/verify', params: { email: me.email } })}
                />
              </View>
            )}
          </Card>
        )}

        {signedIn && me && !isPending && (
          <Section title={t.account.profile}>
            <ListRow icon={UserRound} title={t.account.editProfile} onPress={() => router.push('/profile/edit')} />
            <Divider className="ml-14" />
            <ListRow
              testID="account-sessions"
              icon={Smartphone}
              title={t.account.sessions}
              onPress={() => router.push('/profile/sessions')}
            />
            <Divider className="ml-14" />
            <ListRow
              testID="account-password"
              icon={KeyRound}
              title={t.account.password}
              onPress={() => router.push('/profile/password')}
            />
            {me.emailVerified && (
              <>
                <Divider className="ml-14" />
                <ListRow
                  testID="account-notifications"
                  icon={BellRing}
                  title={t.account.notifications}
                  onPress={() => router.push('/profile/notifications')}
                />
              </>
            )}
          </Section>
        )}

        <Section>
          <SwitchRow title={t.account.voice} subtitle={t.account.voiceHint} value={voice} onValueChange={setVoice} />
        </Section>

        <Section title={t.account.legal}>
          <ListRow
            testID="account-privacy"
            icon={ShieldCheck}
            title={t.account.privacy}
            onPress={() => router.push('/legal/privacy')}
          />
          <Divider className="ml-14" />
          <ListRow icon={FileText} title={t.account.terms} onPress={() => router.push('/legal/terms')} />
          {__DEV__ && (
            <>
              <Divider className="ml-14" />
              <ListRow icon={Palette} title={t.account.design} onPress={() => router.push('/design')} />
            </>
          )}
        </Section>

        {signedIn && (
          <Section>
            <ListRow
              testID="account-sign-out"
              icon={LogOut}
              title={t.account.signOut}
              onPress={leaving ? undefined : signOut}
            />
            <Divider className="ml-14" />
            <ListRow
              testID="account-delete"
              icon={Trash2}
              title={t.account.delete}
              destructive
              onPress={() => router.push('/profile/delete')}
            />
          </Section>
        )}

        <Text variant="caption" tone="muted" className="text-center">
          {`${t.app.name} · ${t.account.version(Constants.expoConfig?.version ?? '0')}`}
        </Text>
      </ScrollView>
    </TabScreen>
  )
}
