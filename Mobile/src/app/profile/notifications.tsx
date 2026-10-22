import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { notificationSettingsQuery, updateNotificationSettings } from '@/api/account'
import { isApiError } from '@/api/errors'
import { Divider } from '@/components/ui/divider'
import { SwitchRow } from '@/components/ui/list-row'
import { Screen } from '@/components/ui/screen'
import { Section } from '@/components/ui/section'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/toast'
import { useMe } from '@/features/auth/use-me'
import { PushUnavailableBanner } from '@/features/notifications/push-unavailable-banner'
import { t } from '@/i18n'

/** Préférences de notification, par type (les types gérant ne concernent que les gérants). */
export default function NotificationSettings() {
  const qc = useQueryClient()
  const { me } = useMe()
  const q = useQuery(notificationSettingsQuery)
  const save = useMutation({
    mutationFn: updateNotificationSettings,
    onMutate: async (settings) => {
      await qc.cancelQueries({ queryKey: notificationSettingsQuery.queryKey })
      const previous = qc.getQueryData(notificationSettingsQuery.queryKey)
      if (previous) {
        qc.setQueryData(notificationSettingsQuery.queryKey, {
          items: previous.items.map((i) => settings.find((s) => s.type === i.type) ?? i),
        })
      }
      return { previous }
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(notificationSettingsQuery.queryKey, ctx.previous)
      toast.error(isApiError(e) ? e.userMessage : t.common.errorTitle)
    },
  })
  const items = (q.data ?? []).filter((s) => me?.role === 'manager' || s.type === 'back_in_stock')
  return (
    <Screen title={t.account.notifications}>
      <PushUnavailableBanner body={me?.role === 'manager' ? t.push.unavailable.manager : undefined} />
      {q.isPending ? (
        <Skeleton height={72} className="rounded-xl" />
      ) : (
        <Section>
          {items.map((s, i) => (
            <SwitchRowWithDivider key={s.type} divider={i > 0}>
              <SwitchRow
                title={t.account.notificationTypes[s.type] ?? s.type}
                subtitle={t.account.notificationHints[s.type]}
                value={s.enabled}
                onValueChange={(enabled) => save.mutate([{ type: s.type, enabled }])}
              />
            </SwitchRowWithDivider>
          ))}
        </Section>
      )}
    </Screen>
  )
}

function SwitchRowWithDivider({ divider, children }: { divider: boolean; children: React.ReactNode }) {
  return (
    <>
      {divider && <Divider className="ml-4" />}
      {children}
    </>
  )
}
