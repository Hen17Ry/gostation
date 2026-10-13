import { useQueryClient } from '@tanstack/react-query'
import { Save } from 'lucide-react-native'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Alert, View } from 'react-native'
import * as z from 'zod/mini'

import { meKeys } from '@/api/keys'
import {
  invalidateOtherVersions,
  isVersionConflict,
  managerStationQuery,
  updateStation,
  type Versioned,
} from '@/api/manager'
import type { ManagerStation } from '@/api/schemas'
import { FormField } from '@/components/form/form-field'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import { applyApiErrors } from '@/lib/form-errors'
import { haptics } from '@/lib/haptics'
import { IFU_LENGTH, normalizePhone, stationFields } from '@/lib/validation'
import { zodResolver } from '@/lib/zod-resolver'

const schema = z.object(stationFields)
type Values = z.infer<typeof schema>
const FIELDS = ['name', 'brand', 'ifu', 'rccm', 'address', 'city', 'phone'] as const

const valuesOf = (s: ManagerStation): Values => ({
  name: s.name,
  brand: s.brand ?? '',
  ifu: s.ifu,
  rccm: s.rccm,
  address: s.address,
  city: s.city ?? '',
  phone: s.phone,
})

/**
 * Profil de la station (D14, D64) : nom, marque, IFU, RCCM, adresse, ville, téléphone. Seuls les
 * champs modifiés sont envoyés. Sur une station approuvée, un changement d'IFU ou de RCCM est
 * précédé d'un dialogue (retour en vérification). Sur 412, les valeurs à jour s'affichent et la
 * saisie reste dans les champs modifiés.
 */
export function StationForm({ station, onSaved }: { station: Versioned<ManagerStation>; onSaved?: () => void }) {
  const qc = useQueryClient()
  const [etag, setEtag] = useState(station.etag)
  const [notice, setNotice] = useState<string | null>(null)
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: valuesOf(station.data) })

  // Nouvelle lecture (autre écran, rechargement) : champs non modifiés recalés, saisie gardée.
  useEffect(() => {
    setEtag(station.etag)
    form.reset(valuesOf(station.data), { keepDirtyValues: true })
  }, [station.etag]) // eslint-disable-line react-hooks/exhaustive-deps -- recalage sur la version seulement

  const save = form.handleSubmit(async (v) => {
    const before = valuesOf(station.data)
    const body: Record<string, string> = {}
    for (const f of FIELDS) {
      const next = f === 'phone' ? normalizePhone(v[f].trim()) : v[f].trim()
      const prev = f === 'phone' ? normalizePhone(before[f]) : before[f]
      if (next !== prev) body[f] = next
    }
    if (Object.keys(body).length === 0) {
      toast.info(t.manager.station.saved)
      return
    }
    const identity = 'ifu' in body || 'rccm' in body
    if (identity && station.data.status === 'approved') {
      const ok = await new Promise<boolean>((resolve) =>
        Alert.alert(t.manager.station.identityTitle, t.manager.station.identityBody, [
          { text: t.common.cancel, style: 'cancel', onPress: () => resolve(false) },
          { text: t.manager.station.identityConfirm, style: 'destructive', onPress: () => resolve(true) },
        ]),
      )
      if (!ok) return
    }
    setNotice(null)
    try {
      const res = await updateStation(body, etag)
      qc.setQueryData(managerStationQuery.queryKey, res)
      void invalidateOtherVersions(qc, managerStationQuery.queryKey)
      form.reset(valuesOf(res.data))
      setEtag(res.etag)
      haptics.success()
      if (res.data.status !== station.data.status) {
        // Retour en vérification : GET /me bascule l'app sur l'écran de statut.
        toast.info(t.manager.station.backToPending)
        void qc.invalidateQueries({ queryKey: meKeys.profile() })
      } else toast.success(t.manager.station.saved)
      onSaved?.()
    } catch (e) {
      if (isVersionConflict(e)) {
        haptics.warning()
        const fresh = await qc.fetchQuery({ ...managerStationQuery, staleTime: 0 }).catch(() => null)
        if (fresh) {
          form.reset(valuesOf(fresh.data), { keepDirtyValues: true })
          setEtag(fresh.etag)
        }
        setNotice(t.manager.station.conflictBody)
        return
      }
      haptics.error()
      setNotice(applyApiErrors(e, form.setError, FIELDS))
    }
  })

  const ifu = form.watch('ifu')
  return (
    <View className="gap-4">
      {notice && (
        <Banner
          tone="warning"
          title={notice === t.manager.station.conflictBody ? t.manager.station.conflictTitle : undefined}
        >
          {notice}
        </Banner>
      )}
      <FormField testID="station-name" control={form.control} name="name" label={t.manager.stationName} />
      <FormField
        testID="station-brand"
        control={form.control}
        name="brand"
        label={t.manager.brand}
        hint={t.manager.brandHint}
      />
      <FormField
        testID="station-ifu"
        control={form.control}
        name="ifu"
        label={t.manager.ifu}
        hint={t.manager.ifuHint(ifu.replace(/\D/g, '').length)}
        keyboardType="number-pad"
        maxLength={IFU_LENGTH}
      />
      <FormField
        testID="station-rccm"
        control={form.control}
        name="rccm"
        label={t.manager.rccm}
        hint={t.manager.rccmHint}
        autoCapitalize="characters"
      />
      <FormField testID="station-address" control={form.control} name="address" label={t.manager.address} />
      <FormField testID="station-city" control={form.control} name="city" label={t.manager.city} />
      <FormField
        testID="station-phone"
        control={form.control}
        name="phone"
        label={t.manager.phone}
        hint={t.manager.phoneHint}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
      />
      <Button
        testID="station-save"
        label={t.manager.station.save}
        icon={Save}
        loading={form.formState.isSubmitting}
        onPress={save}
      />
    </View>
  )
}
