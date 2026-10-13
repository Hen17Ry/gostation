import { useQuery } from '@tanstack/react-query'
import { Ban, Flag, Info } from 'lucide-react-native'
import { useState } from 'react'
import { ScrollView, View } from 'react-native'

import { isApiError } from '@/api/errors'
import { managerReportsQuery } from '@/api/manager'
import type { ManagerReportPage } from '@/api/schemas'
import { Badge } from '@/components/ui/badge'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Chip } from '@/components/ui/choice-tile'
import { EmptyState } from '@/components/ui/empty-state'
import { Section } from '@/components/ui/section'
import { Skeleton } from '@/components/ui/skeleton'
import { TabScreen } from '@/components/ui/tab-screen'
import { Text } from '@/components/ui/text'
import { t } from '@/i18n'
import { agoFrom } from '@/lib/format'
import { useTheme } from '@/theme/theme'

type Reason = ManagerReportPage['items'][number]['reason']
const reasonLabel = (reason: Reason, product: { label: string } | null) =>
  product ? `${t.manager.reports.reasons[reason]} · ${product.label}` : t.manager.reports.reasons[reason]

const STATUS = {
  open: { label: t.manager.reports.statusOpen, tone: 'warning' },
  resolved: { label: t.manager.reports.statusResolved, tone: 'success' },
  dismissed: { label: t.manager.reports.statusDismissed, tone: 'neutral' },
} as const

/**
 * Signalements reçus (D29, D32, D64) : effets en cours (badge, exclusion), signalements par motif
 * et par produit, jamais l'identité ni le commentaire des auteurs ; seuils et clôture expliqués.
 */
export function ReportsScreen() {
  const { colors } = useTheme()
  const [status, setStatus] = useState<'open' | 'all'>('open')
  const q = useQuery(managerReportsQuery(status))
  const page = q.data

  return (
    <TabScreen title={t.manager.reports.title}>
      <ScrollView contentContainerClassName="gap-6 px-5 pb-10">
        <Text variant="callout" tone="muted">
          {t.manager.reports.subtitle}
        </Text>

        <Section title={t.manager.reports.effects}>
          {!page ? (
            <Skeleton height={72} />
          ) : page.flags.length === 0 ? (
            <Card>
              <Text variant="subhead" tone="muted">
                {t.manager.reports.noEffect}
              </Text>
            </Card>
          ) : (
            <View className="gap-3">
              {page.flags.map((f) => (
                <Card key={`${f.reason}-${f.product?.id ?? 0}`} className="gap-2" testID={`report-flag-${f.reason}`}>
                  <View className="flex-row items-center gap-2">
                    {f.level === 'excluded' ? (
                      <Ban size={18} color={colors['danger-subtle-foreground']} />
                    ) : (
                      <Flag size={18} color={colors['warning-subtle-foreground']} />
                    )}
                    <Text variant="headline" className="flex-1">
                      {reasonLabel(f.reason, f.product)}
                    </Text>
                  </View>
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Badge
                      label={f.level === 'excluded' ? t.manager.reports.excluded : t.manager.reports.flagged}
                      tone={f.level === 'excluded' ? 'danger' : 'warning'}
                    />
                    <Text variant="footnote" tone="muted">
                      {t.manager.reports.reporters(f.reporters)} · {agoFrom(f.flaggedAt)}
                    </Text>
                  </View>
                </Card>
              ))}
            </View>
          )}
        </Section>

        <Section title={t.manager.reports.history}>
          <View className="flex-row gap-2" accessibilityRole="radiogroup">
            <Chip label={t.manager.reports.open} selected={status === 'open'} onPress={() => setStatus('open')} />
            <Chip label={t.manager.reports.all} selected={status === 'all'} onPress={() => setStatus('all')} />
          </View>
          {q.isError && !page ? (
            <Banner
              tone="danger"
              action={<Button label={t.common.retry} size="sm" variant="outline" onPress={() => q.refetch()} />}
            >
              {isApiError(q.error) ? q.error.userMessage : t.common.errorTitle}
            </Banner>
          ) : !page ? (
            <Skeleton height={120} />
          ) : page.items.length === 0 ? (
            <EmptyState title={t.manager.reports.none} body={t.manager.reports.noneBody} />
          ) : (
            <Card flush className="overflow-hidden">
              {page.items.map((r, i) => (
                <View
                  key={r.id}
                  accessible
                  accessibilityLabel={`${reasonLabel(r.reason, r.product)}, ${STATUS[r.status].label}, ${agoFrom(r.createdAt)}`}
                  className={`min-h-14 flex-row items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-border' : ''}`}
                >
                  <View className="flex-1 gap-0.5">
                    <Text variant="body" weight="medium">
                      {reasonLabel(r.reason, r.product)}
                    </Text>
                    <Text variant="footnote" tone="muted">
                      {agoFrom(r.createdAt)}
                    </Text>
                  </View>
                  <Badge label={STATUS[r.status].label} tone={STATUS[r.status].tone} />
                </View>
              ))}
            </Card>
          )}
        </Section>

        <Card className="gap-3">
          <View className="flex-row items-center gap-2">
            <Info size={18} color={colors['brand-text']} />
            <Text variant="headline" accessibilityRole="header">
              {t.manager.reports.rulesTitle}
            </Text>
          </View>
          {t.manager.reports.rules.map((rule) => (
            <View key={rule} className="flex-row gap-2">
              <Text variant="subhead" tone="muted">
                •
              </Text>
              <Text variant="subhead" tone="muted" className="flex-1">
                {rule}
              </Text>
            </View>
          ))}
        </Card>
      </ScrollView>
    </TabScreen>
  )
}
