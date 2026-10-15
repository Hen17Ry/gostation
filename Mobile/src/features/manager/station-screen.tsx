import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { Clock, ExternalLink, MapPin, PackageCheck } from 'lucide-react-native'
import { KeyboardAvoidingView, ScrollView, View } from 'react-native'

import { isApiError } from '@/api/errors'
import { managerStationQuery } from '@/api/manager'
import { Badge } from '@/components/ui/badge'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ListRow } from '@/components/ui/list-row'
import { Section } from '@/components/ui/section'
import { Skeleton } from '@/components/ui/skeleton'
import { TabScreen } from '@/components/ui/tab-screen'
import { t } from '@/i18n'

import { StationForm } from './station-form'

/** « Ma station » : configuration (position, horaires, produits) et profil modifiable. */
export function StationScreen() {
  const station = useQuery(managerStationQuery)
  const s = station.data?.data
  const locationStatus = s?.pendingMove
    ? t.manager.station.locationPending
    : s?.location
      ? t.manager.station.locationSet
      : t.manager.station.locationMissing

  return (
    <TabScreen title={t.manager.station.title}>
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-6 px-5 pb-10">
          {station.isError && !s && (
            <Banner
              tone="danger"
              action={<Button label={t.common.retry} size="sm" variant="outline" onPress={() => station.refetch()} />}
            >
              {isApiError(station.error) ? station.error.userMessage : t.common.errorTitle}
            </Banner>
          )}
          {!s ? (
            <View className="gap-3">
              <Skeleton height={56} />
              <Skeleton height={168} />
              <Skeleton height={320} />
            </View>
          ) : (
            <>
              <View className="gap-2">
                <Badge
                  label={s.setup.searchable ? t.manager.setup.done : t.manager.setup.title}
                  tone={s.setup.searchable ? 'success' : 'warning'}
                />
              </View>
              <Section title={t.manager.station.setupSection} bare>
                <Card flush className="overflow-hidden">
                  <ListRow
                    testID="station-location"
                    icon={MapPin}
                    title={t.manager.station.location}
                    subtitle={locationStatus}
                    onPress={() => router.push('/manager/location')}
                  />
                  <ListRow
                    testID="station-hours"
                    icon={Clock}
                    title={t.manager.station.hours}
                    subtitle={s.setup.openingHours ? undefined : t.manager.station.hoursMissing}
                    onPress={() => router.push('/manager/hours')}
                  />
                  <ListRow
                    testID="station-products"
                    icon={PackageCheck}
                    title={t.manager.station.products}
                    onPress={() => router.push('/manager/products')}
                  />
                  {s.setup.searchable && (
                    <ListRow
                      icon={ExternalLink}
                      title={t.manager.station.publicPage}
                      onPress={() => router.push({ pathname: '/station/[id]', params: { id: s.id } })}
                    />
                  )}
                </Card>
              </Section>
              <Section title={t.manager.station.profile} bare>
                <Card>
                  <StationForm station={station.data!} />
                </Card>
              </Section>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </TabScreen>
  )
}
