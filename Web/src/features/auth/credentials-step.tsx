import { zodResolver } from '@hookform/resolvers/zod'
import { Eye, EyeOff, LifeBuoy, ShieldAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import * as z from 'zod/mini'

import type { AdminChallenge } from '@/api/schemas'
import { Field } from '@/components/form/field'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { t } from '@/i18n'

import { adminLogin } from './api'
import { asApiError, errorNotice, type Notice } from './notice'
import { StepHeader } from './step-header'

// Première étape de la connexion, seule chargée avec l'écran : les étapes 2FA (input-otp, QR code,
// codes de secours) sont dans ./steps, chargé en arrière-plan.

export function NoticeAlert({ notice }: { notice: Notice }) {
  return (
    <Alert variant={notice.variant}>
      {notice.variant === 'destructive' ? <ShieldAlert aria-hidden /> : <LifeBuoy aria-hidden />}
      {notice.title && <AlertTitle>{notice.title}</AlertTitle>}
      <AlertDescription>{notice.body}</AlertDescription>
    </Alert>
  )
}

// ── 1. Email et mot de passe ────────────────────────────────────────────────

const credentialsSchema = z.object({
  email: z
    .string()
    .check(
      z.trim(),
      z.minLength(1, { error: t.validation.emailRequired }),
      z.regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { error: t.validation.emailInvalid }),
    ),
  password: z.string().check(z.minLength(1, { error: t.validation.passwordRequired })),
})
type Credentials = z.infer<typeof credentialsSchema>

export function CredentialsStep({
  notice,
  defaultEmail,
  onChallenge,
}: {
  notice?: Notice
  defaultEmail?: string
  onChallenge: (challenge: AdminChallenge, email: string) => void
}) {
  const [error, setError] = useState<Notice | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const form = useForm<Credentials>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: { email: defaultEmail ?? '', password: '' },
  })
  const { errors, isSubmitting } = form.formState

  // Chaque étape remplace la précédente sur place : le focus va au premier champ utile.
  useEffect(() => form.setFocus(defaultEmail ? 'password' : 'email'), [form, defaultEmail])

  async function onSubmit(values: Credentials) {
    setError(null)
    try {
      onChallenge(await adminLogin(values.email, values.password), values.email)
    } catch (e) {
      setError(errorNotice(asApiError(e)))
      form.resetField('password')
      form.setFocus('password')
    }
  }

  const shown = error ?? notice
  return (
    <div className="flex flex-col gap-6">
      <StepHeader title={t.auth.signInTitle} subtitle={t.auth.signInSubtitle} />
      {shown && <NoticeAlert notice={shown} />}
      <form noValidate onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
        <Field label={t.auth.email} error={errors.email?.message}>
          {(p) => (
            <Input
              {...p}
              {...form.register('email')}
              type="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={t.auth.emailPlaceholder}
            />
          )}
        </Field>
        <Field label={t.auth.password} error={errors.password?.message}>
          {(p) => (
            <div className="relative">
              <Input
                {...p}
                {...form.register('password')}
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute top-0.5 right-0.5 text-muted-foreground"
                aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((s) => !s)}
              >
                {showPassword ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              </Button>
            </div>
          )}
        </Field>
        <Button type="submit" size="lg" className="mt-2 w-full" loading={isSubmitting}>
          {isSubmitting ? t.auth.submitting : t.auth.submit}
        </Button>
      </form>
    </div>
  )
}
