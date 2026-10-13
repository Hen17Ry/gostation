import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Globe, Smartphone } from 'lucide-react-native'
import { View } from 'react-native'

import { logoutAll, revokeSession, sessionsQuery } from '@/api/account'
import { isApiError } from '@/api/errors'
import { meKeys } from '@/api/keys'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Divider } from '@/components/ui/divider'
import { Screen } from '@/components/ui/screen'
import { Section } from '@/components/ui/section'
import { Skeleton } from '@/components/ui/skeleton'
import { Text } from '@/components/ui/text'
import { toast } from '@/components/ui/toast'
import { deviceLabel } from '@/features/account/device-label'
import { t } from '@/i18n'
import { agoFrom } from '@/lib/format'
import { useTheme } from '@/theme/theme'

/** Sessions ouvertes : appareil courant signalé, déconnexion d'une session ou de toutes. */
export default function Sessions() {
  const qc = useQueryClient()
  const { colors } = useTheme()
  const q = useQuery(sessionsQuery)
  const revoke = useMutation({
    mutationFn: revokeSession,
    onSettled: () => qc.invalidateQueries({ queryKey: meKeys.sessions() }),
    onError: (e) => toast.error(isApiError(e) ? e.userMessage : t.common.errorTitle),
  })
  const all = useMutation({
    mutationFn: logoutAll,
    onError: (e) => toast.error(isApiError(e) ? e.userMessage : t.common.errorTitle),
  })

  return (
    <Screen
      title={t.account.sessions}
      subtitle={t.account.sessionsBody}
      footer={
        <Button label={t.account.revokeAll} variant="outline" loading={all.isPending} onPress={() => all.mutate()} />
      }
    >
      {q.isPending ? (
        <Skeleton height={160} className="rounded-xl" />
      ) : (
        <Section>
          {(q.data ?? []).map((s, i) => {
            const Icon = s.client === 'mobile' ? Smartphone : Globe
            return (
              <View key={s.id}>
                {i > 0 && <Divider className="ml-14" />}
                <View className="min-h-16 flex-row items-center gap-3.5 px-4 py-3">
                  <Icon size={22} color={colors['muted-foreground']} />
                  <View className="flex-1 gap-0.5">
                    <Text variant="body" weight="medium" numberOfLines={1}>
                      {deviceLabel(s)}
                    </Text>
                    <Text variant="footnote" tone="muted">
                      {t.account.lastUsed(agoFrom(s.lastUsedAt))}
                    </Text>
                  </View>
                  {s.current ? (
                    <Badge label={t.account.thisDevice} tone="brand" />
                  ) : (
                    <Button label={t.account.revoke} size="sm" variant="ghost" onPress={() => revoke.mutate(s.id)} />
                  )}
                </View>
              </View>
            )
          })}
        </Section>
      )}
    </Screen>
  )
}
