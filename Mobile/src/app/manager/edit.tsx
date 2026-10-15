import { useQuery } from '@tanstack/react-query'
import { router } from 'expo-router'
import { View } from 'react-native'

import { managerStationQuery } from '@/api/manager'
import { Screen } from '@/components/ui/screen'
import { Skeleton } from '@/components/ui/skeleton'
import { StationForm } from '@/features/manager/station-form'
import { t } from '@/i18n'

/** Dossier refusé : correction des informations de la station (D15). */
export default function EditRejectedStation() {
  const station = useQuery(managerStationQuery)
  return (
    <Screen title={t.manager.status.edit} subtitle={t.manager.status.rejectedBody}>
      {station.data ? (
        <StationForm station={station.data} onSaved={() => router.back()} />
      ) : (
        <View className="gap-3">
          <Skeleton height={72} />
          <Skeleton height={72} />
          <Skeleton height={72} />
        </View>
      )}
    </Screen>
  )
}
