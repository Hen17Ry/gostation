import { useQueryClient } from '@tanstack/react-query'
import { router } from 'expo-router'
import { ArrowLeft, ArrowRight, Send } from 'lucide-react-native'
import { useEffect, useRef, useState } from 'react'
import { type FieldPath, useForm } from 'react-hook-form'
import { AccessibilityInfo, BackHandler, findNodeHandle, View } from 'react-native'
import * as z from 'zod/mini'

import { PRIVACY_POLICY_VERSION } from '@/api/account'
import { isApiError } from '@/api/errors'
import { meKeys } from '@/api/keys'
import { type DocumentFile, registerManager } from '@/api/manager'
import { FormField } from '@/components/form/form-field'
import { PolicyField } from '@/components/form/policy-field'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Screen } from '@/components/ui/screen'
import { SegmentedProgress } from '@/components/ui/segmented-progress'
import { Text } from '@/components/ui/text'
import { discardDocument } from '@/features/manager/document'
import { DocumentField } from '@/features/manager/document-field'
import { t } from '@/i18n'
import { fieldMessage } from '@/lib/form-errors'
import { haptics } from '@/lib/haptics'
import { clearSecureDraft, readSecureDraft, writeSecureDraft } from '@/lib/secure-draft'
import { emailField, IFU_LENGTH, nameField, newPasswordField, normalizePhone, stationFields } from '@/lib/validation'
import { zodResolver } from '@/lib/zod-resolver'

const schema = z.object({
  firstName: nameField,
  lastName: nameField,
  email: emailField,
  password: newPasswordField,
  policy: z.boolean().check(z.refine((v) => v, { error: t.validation.policy })),
  stationName: stationFields.name,
  brand: stationFields.brand,
  ifu: stationFields.ifu,
  rccm: stationFields.rccm,
  address: stationFields.address,
  city: stationFields.city,
  phone: stationFields.phone,
})
type Values = z.infer<typeof schema>

const STEPS: FieldPath<Values>[][] = [
  ['firstName', 'lastName', 'email', 'password', 'policy'],
  ['stationName', 'brand', 'ifu', 'rccm', 'address', 'city', 'phone'],
  [],
]
const DRAFT = 'manager-sign-up'
/** Champs gardés en brouillon chiffré (jamais le mot de passe, D62). */
type Draft = Omit<Values, 'password' | 'policy'>
const EMPTY: Values = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  policy: false,
  stationName: '',
  brand: '',
  ifu: '',
  rccm: '',
  address: '',
  city: '',
  phone: '+229 ',
}

/**
 * Inscription d'un gérant (D62) : compte, station, justificatif, avec une barre de progression.
 * Brouillon chiffré des champs texte repris si l'app a été fermée ; justificatif jamais conservé.
 * Ensuite : code à 6 chiffres, puis écran de statut.
 */
export default function ManagerSignUp() {
  const qc = useQueryClient()
  const [step, setStep] = useState(0)
  const [doc, setDoc] = useState<DocumentFile | null>(null)
  const [docError, setDocError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restored, setRestored] = useState(false)
  const [busy, setBusy] = useState(false)
  const heading = useRef<View>(null)
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: EMPTY, mode: 'onTouched' })

  // Reprise du brouillon, puis sauvegarde à chaque saisie (débit limité).
  useEffect(() => {
    let alive = true
    void readSecureDraft<Draft>(DRAFT).then((d) => {
      if (!alive || !d) return
      form.reset({ ...EMPTY, ...d })
      setRestored(true)
    })
    let timer: ReturnType<typeof setTimeout> | null = null
    const sub = form.watch((v) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const { password: _p, policy: _a, ...rest } = v as Values
        void writeSecureDraft(DRAFT, rest)
      }, 400)
    })
    return () => {
      alive = false
      sub.unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [form])
  // Retour d'Android : étape précédente (le formulaire n'est fermé qu'à la première étape).
  useEffect(() => {
    if (step === 0) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goTo(step - 1)
      return true
    })
    return () => sub.remove()
  }, [step])
  // Écran quitté sans envoi : la copie locale du justificatif est supprimée.
  useEffect(() => () => discardDocument(doc), [doc])

  const goTo = (n: number) => {
    setStep(n)
    setError(null)
    // Lecteur d'écran : le focus revient sur le titre de l'étape.
    requestAnimationFrame(() => {
      const node = heading.current && findNodeHandle(heading.current)
      if (node) AccessibilityInfo.setAccessibilityFocus(node)
    })
  }

  const next = async () => {
    if (!(await form.trigger(STEPS[step]))) {
      haptics.warning()
      return
    }
    haptics.selection()
    goTo(step + 1)
  }

  const submit = async () => {
    if (!doc) {
      setDocError(t.manager.documentRequired)
      haptics.warning()
      return
    }
    if (!(await form.trigger())) {
      goTo(STEPS.findIndex((fields) => fields.some((f) => form.getFieldState(f).invalid)))
      return
    }
    const v = form.getValues()
    setBusy(true)
    setError(null)
    setDocError(null)
    try {
      const me = await registerManager(
        {
          firstName: v.firstName,
          lastName: v.lastName,
          email: v.email,
          password: v.password,
          stationName: v.stationName,
          brand: v.brand,
          ifu: v.ifu,
          rccm: v.rccm,
          address: v.address,
          city: v.city,
          phone: normalizePhone(v.phone.trim()),
        },
        doc,
        PRIVACY_POLICY_VERSION,
      )
      discardDocument(doc)
      setDoc(null)
      await clearSecureDraft(DRAFT)
      qc.setQueryData(meKeys.profile(), me)
      haptics.success()
      router.replace({ pathname: '/auth/verify', params: { email: me.email } })
    } catch (e) {
      haptics.error()
      if (!isApiError(e)) {
        setError(t.common.errorTitle)
        return
      }
      if (e.code.startsWith('upload.')) {
        setDocError(e.userMessage)
        return
      }
      if (e.code === 'auth.email_taken') {
        form.setError('email', { message: e.userMessage })
        goTo(0)
        return
      }
      // Champs refusés par l'API : rattachés au formulaire, retour à la première étape concernée.
      let first = -1
      for (const f of e.fields) {
        const name = f.field as FieldPath<Values>
        const at = STEPS.findIndex((fields) => fields.includes(name))
        if (at < 0) continue
        form.setError(name, { message: fieldMessage(f.field, f.code) })
        if (first < 0 || at < first) first = at
      }
      if (first >= 0) goTo(first)
      else setError(e.userMessage)
    } finally {
      setBusy(false)
    }
  }

  const ifu = form.watch('ifu')
  const last = step === STEPS.length - 1
  return (
    <Screen
      title={t.manager.signUpTitle}
      footer={
        <View className="flex-row gap-3">
          <Button
            testID="manager-sign-up-previous"
            label={t.manager.previous}
            icon={ArrowLeft}
            variant="outline"
            size="lg"
            onPress={() => (step === 0 ? router.back() : goTo(step - 1))}
          />
          <Button
            testID={last ? 'manager-sign-up-submit' : 'manager-sign-up-next'}
            label={last ? t.manager.submit : t.manager.next}
            icon={last ? Send : ArrowRight}
            size="lg"
            className="flex-1"
            loading={busy}
            onPress={last ? submit : next}
          />
        </View>
      }
    >
      <SegmentedProgress steps={t.manager.steps} current={step} label={t.manager.stepOf(step + 1, STEPS.length)} />
      {restored && step === 0 && <Banner tone="info">{t.manager.draftRestored}</Banner>}
      {error && <Banner tone="danger">{error}</Banner>}
      <View ref={heading} accessible accessibilityRole="header" className="gap-1">
        <Text variant="title3">{t.manager.steps[step]}</Text>
        <Text variant="subhead" tone="muted">
          {t.manager.stepHints[step]}
        </Text>
      </View>

      {step === 0 && (
        <>
          <View className="flex-row gap-3">
            <FormField
              testID="manager-first-name"
              control={form.control}
              name="firstName"
              label={t.auth.firstName}
              autoComplete="given-name"
              className="flex-1"
            />
            <FormField
              testID="manager-last-name"
              control={form.control}
              name="lastName"
              label={t.auth.lastName}
              autoComplete="family-name"
              className="flex-1"
            />
          </View>
          <FormField
            testID="manager-email"
            control={form.control}
            name="email"
            label={t.auth.email}
            autoComplete="email"
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <FormField
            testID="manager-password"
            control={form.control}
            name="password"
            label={t.auth.password}
            hint={t.auth.passwordHint}
            secure
            autoComplete="new-password"
          />
          <PolicyField testID="manager-policy" control={form.control} name="policy" />
        </>
      )}

      {step === 1 && (
        <>
          <FormField
            testID="manager-station-name"
            control={form.control}
            name="stationName"
            label={t.manager.stationName}
          />
          <FormField
            testID="manager-brand"
            control={form.control}
            name="brand"
            label={t.manager.brand}
            hint={t.manager.brandHint}
          />
          <FormField
            testID="manager-ifu"
            control={form.control}
            name="ifu"
            label={t.manager.ifu}
            hint={t.manager.ifuHint(ifu.replace(/\D/g, '').length)}
            keyboardType="number-pad"
            maxLength={IFU_LENGTH}
          />
          <FormField
            testID="manager-rccm"
            control={form.control}
            name="rccm"
            label={t.manager.rccm}
            hint={t.manager.rccmHint}
            autoCapitalize="characters"
          />
          <FormField testID="manager-address" control={form.control} name="address" label={t.manager.address} />
          <FormField testID="manager-city" control={form.control} name="city" label={t.manager.city} />
          <FormField
            testID="manager-phone"
            control={form.control}
            name="phone"
            label={t.manager.phone}
            hint={t.manager.phoneHint}
            keyboardType="phone-pad"
            autoComplete="tel"
          />
        </>
      )}

      {step === 2 && (
        <DocumentField
          value={doc}
          onChange={(f) => {
            setDoc(f)
            setDocError(null)
          }}
          error={docError}
        />
      )}
    </Screen>
  )
}
