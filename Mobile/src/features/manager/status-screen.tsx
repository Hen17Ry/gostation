import { useQueryClient } from '@tanstack/react-query'
import * as Linking from 'expo-linking'
import { router } from 'expo-router'
import {
  Ban,
  FilePen,
  FileUp,
  FolderLock,
  Hourglass,
  LogOut,
  Mail,
  MailCheck,
  RefreshCw,
  ShieldX,
  UserRound,
} from 'lucide-react-native'
import { useState } from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { logout } from '@/api/account'
import { meKeys } from '@/api/keys'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ListRow } from '@/components/ui/list-row'
import { Text } from '@/components/ui/text'
import { useMe } from '@/features/auth/use-me'
import { t } from '@/i18n'
import { useTheme } from '@/theme/theme'

const SUPPORT_EMAIL = process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() || null

/**
 * Statut du dossier (D63) : seul écran d'un gérant non approuvé. En attente : ce qui va se passer
 * et le délai ; refusé : motif, correction, nouveau justificatif ; suspendu : motif et contact.
 * Le compte (déconnexion, profil) reste accessible.
 */
export function StatusScreen() {
  const qc = useQueryClient()
  const insets = useSafeAreaInsets()
  const { colors } = useTheme()
  const { me, isFetching } = useMe()
  const [leaving, setLeaving] = useState(false)
  const station = me?.station
  const status = station?.status ?? 'pending'

  const refresh = () => qc.invalidateQueries({ queryKey: meKeys.profile() })

  const head = {
    pending: {
      icon: Hourglass,
      title: t.manager.status.pendingTitle,
      tone: colors['warning-subtle-foreground'],
      bg: 'bg-warning-subtle',
    },
    rejected: {
      icon: ShieldX,
      title: t.manager.status.rejectedTitle,
      tone: colors['danger-subtle-foreground'],
      bg: 'bg-danger-subtle',
    },
    suspended: {
      icon: Ban,
      title: t.manager.status.suspendedTitle,
      tone: colors['danger-subtle-foreground'],
      bg: 'bg-danger-subtle',
    },
    approved: {
      icon: Hourglass,
      title: t.manager.status.pendingTitle,
      tone: colors['warning-subtle-foreground'],
      bg: 'bg-warning-subtle',
    },
  }[status]
  const Icon = head.icon

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <ScrollView
        contentContainerClassName="gap-5 px-5 pb-10 pt-6"
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={refresh} colors={[colors.primary]} />}
      >
        <View className="items-start gap-4" accessibilityLiveRegion="polite">
          <View className={`h-16 w-16 items-center justify-center rounded-full ${head.bg}`}>
            <Icon size={30} color={head.tone} strokeWidth={2.2} />
          </View>
          <View className="gap-1.5">
            <Text variant="caption" weight="semibold" tone="muted" className="uppercase tracking-wide">
              {t.manager.status.title}
              {station ? ` · ${station.name}` : ''}
            </Text>
            <Text testID={`status-${status}`} variant="title1" accessibilityRole="header">
              {head.title}
            </Text>
          </View>
        </View>

        {status === 'pending' && (
          <>
            {me && !me.emailVerified && (
              <Banner
                tone="warning"
                action={
                  <Button
                    label={t.manager.status.verifyEmail}
                    icon={MailCheck}
                    size="sm"
                    variant="outline"
                    onPress={() => router.push({ pathname: '/auth/verify', params: { email: me.email } })}
                  />
                }
              >
                {t.manager.status.verifyFirst}
              </Banner>
            )}
            <Text variant="body">{t.manager.status.pendingBody}</Text>
            <Card className="gap-2">
              <Text variant="headline">{t.manager.status.pendingDelay}</Text>
              <Text variant="subhead" tone="muted">
                {t.manager.status.pendingNext}
              </Text>
            </Card>
          </>
        )}

        {(status === 'rejected' || status === 'suspended') && (
          <>
            <Text variant="body">
              {status === 'rejected' ? t.manager.status.rejectedBody : t.manager.status.suspendedBody}
            </Text>
            <Card className="gap-1.5" testID="status-reason">
              <Text variant="caption" weight="semibold" tone="muted" className="uppercase tracking-wide">
                {t.manager.status.reason}
              </Text>
              <Text variant="body">{station?.statusReason ?? t.manager.status.noReason}</Text>
            </Card>
          </>
        )}

        {status === 'rejected' && (
          <View className="gap-3">
            <Button
              testID="status-edit"
              label={t.manager.status.edit}
              icon={FilePen}
              size="lg"
              onPress={() => router.push('/manager/edit')}
            />
            <Button
              testID="status-resubmit"
              label={t.manager.status.resubmit}
              icon={FileUp}
              size="lg"
              variant="outline"
              onPress={() => router.push('/manager/resubmit')}
            />
          </View>
        )}

        {status === 'suspended' && (
          <View className="gap-3">
            <Text variant="subhead" tone="muted">
              {t.manager.status.contact}
            </Text>
            {SUPPORT_EMAIL && (
              <Button
                label={t.manager.status.writeTeam}
                icon={Mail}
                variant="outline"
                onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
              />
            )}
          </View>
        )}

        <Button
          testID="status-refresh"
          label={t.manager.status.refresh}
          icon={RefreshCw}
          variant="ghost"
          loading={isFetching}
          onPress={refresh}
          className="self-start"
        />

        <Card flush className="overflow-hidden">
          <ListRow icon={UserRound} title={t.account.editProfile} onPress={() => router.push('/profile/edit')} />
          <ListRow
            testID="status-data"
            icon={FolderLock}
            title={t.account.myData}
            subtitle={t.account.myDataHint}
            onPress={() => router.push('/profile/data')}
          />
          <ListRow
            icon={LogOut}
            title={t.account.signOut}
            onPress={async () => {
              setLeaving(true)
              try {
                await logout()
              } finally {
                setLeaving(false)
              }
            }}
            trailing={leaving ? null : undefined}
          />
        </Card>
      </ScrollView>
    </View>
  )
}
