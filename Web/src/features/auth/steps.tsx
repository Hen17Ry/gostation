import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { ArrowLeft, Copy, Download, Eye, EyeOff, KeyRound, LifeBuoy, ShieldAlert, Smartphone } from 'lucide-react'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import * as z from 'zod/mini'

import { ApiError, isApiError } from '@/api/errors'
import type { AdminChallenge, AdminSession } from '@/api/schemas'
import { Field } from '@/components/form/field'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { t } from '@/i18n'
import { formatCountdown } from '@/lib/format'

import { adminLogin, adminSecondFactor, normalizeRecoveryCode, RECOVERY_CODE_PATTERN, type SecondFactor } from './api'
import { StepHeader } from './step-header'
import { SetupStepper } from './stepper'
import { useCountdown } from './use-countdown'

const QrCode = lazy(() => import('./qr-code'))

export interface Notice {
  variant: 'info' | 'success' | 'destructive'
  title?: string
  body: string
}

/** Place le focus sur l'élément à l'affichage de l'étape. */
function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => ref.current?.focus(), [])
  return ref
}

const asApiError = (e: unknown) => (isApiError(e) ? e : ApiError.network(e))

export function NoticeAlert({ notice }: { notice: Notice }) {
  return (
    <Alert variant={notice.variant}>
      {notice.variant === 'destructive' ? <ShieldAlert aria-hidden /> : <LifeBuoy aria-hidden />}
      {notice.title && <AlertTitle>{notice.title}</AlertTitle>}
      <AlertDescription>{notice.body}</AlertDescription>
    </Alert>
  )
}

/** Message d'une erreur de connexion ; le compte désactivé a son propre encadré. */
function errorNotice(e: ApiError): Notice {
  if (e.code === 'auth.account_disabled') {
    return { variant: 'destructive', title: t.auth.disabledTitle, body: t.auth.disabledBody }
  }
  return { variant: 'destructive', body: e.userMessage }
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

// ── 2. Code TOTP ou code de secours ─────────────────────────────────────────

interface ChallengeProps {
  challenge: AdminChallenge
  expiresAt: number
  onSession: (session: AdminSession) => void
  /** Défi expiré ou épuisé : retour au mot de passe, avec un message. */
  onRestart: (message: string) => void
  onBack: () => void
}

function useSecondFactor({
  challenge,
  onSession,
  onRestart,
}: Pick<ChallengeProps, 'challenge' | 'onSession' | 'onRestart'>) {
  const qc = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(factor: SecondFactor): Promise<boolean> {
    setPending(true)
    setError(null)
    try {
      onSession(await adminSecondFactor(qc, challenge.mfaToken, factor))
      return true
    } catch (e) {
      const err = asApiError(e)
      if (err.code === 'auth.invalid_mfa_token') onRestart(err.userMessage)
      else setError(err.userMessage)
      return false
    } finally {
      setPending(false)
    }
  }
  return { submit, pending, error }
}

function ExpiryNote({ expiresAt, onRestart }: { expiresAt: number; onRestart: (m: string) => void }) {
  const left = useCountdown(expiresAt, () => onRestart(t.auth.challengeExpired))
  return (
    <p className="text-2xs text-muted-foreground tabular-nums" aria-live="off">
      {t.auth.challengeExpires(formatCountdown(left))}
    </p>
  )
}

function OtpField({
  value,
  onChange,
  onComplete,
  error,
  disabled,
  inputRef,
}: {
  value: string
  onChange: (v: string) => void
  onComplete: (v: string) => void
  error: string | null
  disabled: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  return (
    <Field label={t.auth.code} error={error ?? undefined}>
      {(p) => (
        <InputOTP
          {...p}
          ref={inputRef}
          maxLength={6}
          value={value}
          onChange={onChange}
          onComplete={onComplete}
          pattern={REGEXP_ONLY_DIGITS}
          inputMode="numeric"
          autoComplete="one-time-code"
          disabled={disabled}
          containerClassName="justify-between sm:justify-start"
        >
          <InputOTPGroup>
            {[0, 1, 2].map((i) => (
              <InputOTPSlot key={i} index={i} aria-invalid={p['aria-invalid']} />
            ))}
          </InputOTPGroup>
          <InputOTPSeparator />
          <InputOTPGroup>
            {[3, 4, 5].map((i) => (
              <InputOTPSlot key={i} index={i} aria-invalid={p['aria-invalid']} />
            ))}
          </InputOTPGroup>
        </InputOTP>
      )}
    </Field>
  )
}

export function TotpStep({ onUseRecovery, ...props }: ChallengeProps & { onUseRecovery: () => void }) {
  const { submit, pending, error } = useSecondFactor(props)
  const [code, setCode] = useState('')
  const inputRef = useFocusOnMount<HTMLInputElement>()

  async function verify(value: string) {
    if (value.length !== 6 || pending) return
    if (!(await submit({ code: value }))) {
      setCode('')
      inputRef.current?.focus()
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <StepHeader
        icon={<Smartphone className="size-5" aria-hidden />}
        title={t.auth.twoFactorTitle}
        subtitle={t.auth.twoFactorSubtitle}
      />
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void verify(code)
        }}
      >
        <OtpField
          value={code}
          onChange={setCode}
          onComplete={(v) => void verify(v)}
          error={error}
          disabled={pending}
          inputRef={inputRef}
        />
        <ExpiryNote expiresAt={props.expiresAt} onRestart={props.onRestart} />
        <Button type="submit" size="lg" className="w-full" loading={pending} disabled={code.length !== 6}>
          {pending ? t.auth.verifying : t.auth.verify}
        </Button>
      </form>
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={props.onBack}>
          <ArrowLeft aria-hidden />
          {t.auth.back}
        </Button>
        <Button variant="link" size="sm" onClick={onUseRecovery}>
          {t.auth.useRecovery}
        </Button>
      </div>
    </div>
  )
}

export function RecoveryStep({ onUseTotp, ...props }: ChallengeProps & { onUseTotp: () => void }) {
  const { submit, pending, error } = useSecondFactor(props)
  const [value, setValue] = useState('')
  const [formatError, setFormatError] = useState<string | null>(null)
  const inputRef = useFocusOnMount<HTMLInputElement>()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!RECOVERY_CODE_PATTERN.test(value)) {
      setFormatError(t.validation.recoveryFormat)
      inputRef.current?.focus()
      return
    }
    setFormatError(null)
    if (!(await submit({ recoveryCode: value }))) inputRef.current?.select()
  }

  return (
    <div className="flex flex-col gap-6">
      <StepHeader
        icon={<KeyRound className="size-5" aria-hidden />}
        title={t.auth.recoveryTitle}
        subtitle={t.auth.recoverySubtitle}
      />
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
        <Field label={t.auth.recoveryCode} error={formatError ?? error ?? undefined}>
          {(p) => (
            <Input
              {...p}
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(normalizeRecoveryCode(e.target.value).slice(0, 19))}
              placeholder={t.auth.recoveryPlaceholder}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="h-11 font-mono text-base tracking-wider uppercase md:text-base"
            />
          )}
        </Field>
        <ExpiryNote expiresAt={props.expiresAt} onRestart={props.onRestart} />
        <Button type="submit" size="lg" className="w-full" loading={pending}>
          {pending ? t.auth.verifying : t.auth.verify}
        </Button>
      </form>
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={props.onBack}>
          <ArrowLeft aria-hidden />
          {t.auth.back}
        </Button>
        <Button variant="link" size="sm" onClick={onUseTotp}>
          {t.auth.useTotp}
        </Button>
      </div>
    </div>
  )
}

// ── 3. Mise en place de la 2FA ──────────────────────────────────────────────

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(t.auth.copied)
  } catch {
    toast.error(t.auth.copyFailed)
  }
}

export function SetupStep(props: ChallengeProps & { setup: { secret: string; otpauthUri: string } }) {
  const { submit, pending, error } = useSecondFactor(props)
  const [code, setCode] = useState('')
  const inputRef = useFocusOnMount<HTMLInputElement>()
  const grouped = props.setup.secret.match(/.{1,4}/g)?.join(' ') ?? props.setup.secret

  async function verify(value: string) {
    if (value.length !== 6 || pending) return
    if (!(await submit({ code: value }))) {
      setCode('')
      inputRef.current?.focus()
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <StepHeader title={t.auth.setupTitle} subtitle={t.auth.setupSubtitle} />
      <SetupStepper current={code.length > 0 ? 1 : 0} />
      <section
        aria-labelledby="setup-scan"
        className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-elevation-1 sm:flex-row sm:items-center"
      >
        <div className="grid size-40 shrink-0 place-items-center self-center rounded-lg bg-white p-2 ring-1 ring-border">
          <Suspense fallback={<Skeleton className="size-36" />}>
            <QrCode value={props.setup.otpauthUri} label={t.auth.qrAlt('GoStation')} className="size-36" />
          </Suspense>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <p id="setup-scan" className="text-xs text-muted-foreground">
            {t.auth.setupScan}
          </p>
          <div className="flex flex-col gap-1.5">
            <span className="text-2xs font-medium text-muted-foreground">{t.auth.setupManual}</span>
            <div className="flex items-start gap-1 rounded-md border bg-surface-sunken py-1 pr-1 pl-2.5">
              <code
                className="min-w-0 flex-1 py-1 font-mono text-xs leading-relaxed tracking-wide break-words"
                title={grouped}
              >
                {grouped}
              </code>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t.auth.copySecret}
                onClick={() => void copyText(props.setup.secret)}
              >
                <Copy aria-hidden />
              </Button>
            </div>
          </div>
        </div>
      </section>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void verify(code)
        }}
      >
        <p className="text-xs text-muted-foreground">{t.auth.setupVerify}</p>
        <OtpField
          value={code}
          onChange={setCode}
          onComplete={(v) => void verify(v)}
          error={error}
          disabled={pending}
          inputRef={inputRef}
        />
        <ExpiryNote expiresAt={props.expiresAt} onRestart={props.onRestart} />
        <Button type="submit" size="lg" className="w-full" loading={pending} disabled={code.length !== 6}>
          {pending ? t.auth.verifying : t.auth.activate}
        </Button>
      </form>
      <Button variant="ghost" size="sm" className="self-start" onClick={props.onBack}>
        <ArrowLeft aria-hidden />
        {t.auth.back}
      </Button>
    </div>
  )
}

// ── 4. Codes de secours (affichés une seule fois) ──────────────────────────

export function RecoveryCodesStep({ codes, email, onDone }: { codes: string[]; email: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false)

  // Les codes ne seront plus jamais affichés : on prévient avant de quitter la page.
  useEffect(() => {
    if (saved) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = t.auth.codesLeaveWarning
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saved])

  const asText = () =>
    `${t.auth.codesFileHeader(email, new Date().toLocaleString('fr-FR'))}\n${codes.map((c, i) => `${String(i + 1).padStart(2, ' ')}. ${c}`).join('\n')}\n`

  function download() {
    const url = URL.createObjectURL(new Blob([asText()], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = t.auth.codesFileName
    a.click()
    URL.revokeObjectURL(url)
    toast.success(t.auth.downloaded)
  }

  return (
    <div className="flex flex-col gap-6">
      <StepHeader title={t.auth.codesTitle} subtitle={t.auth.codesSubtitle} />
      <SetupStepper current={2} />
      <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-elevation-1">
        <ol
          className="grid grid-cols-1 gap-x-6 gap-y-2 min-[400px]:grid-cols-[repeat(2,max-content)] min-[400px]:justify-between"
          aria-label={t.auth.codesTitle}
          data-testid="recovery-codes"
        >
          {codes.map((code, i) => (
            <li key={code} className="flex items-baseline gap-2 font-mono text-[13px] whitespace-nowrap tabular-nums">
              <span aria-hidden className="w-5 text-right text-2xs text-muted-foreground">
                {i + 1}.
              </span>
              <span className="select-all">{code}</span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button variant="outline" size="sm" onClick={() => void copyText(codes.join('\n'))}>
            <Copy aria-hidden />
            {t.auth.copyCodes}
          </Button>
          <Button variant="outline" size="sm" onClick={download}>
            <Download aria-hidden />
            {t.auth.downloadCodes}
          </Button>
        </div>
      </div>
      <Alert variant="warning">
        <ShieldAlert aria-hidden />
        <AlertDescription>{t.auth.codesWarning}</AlertDescription>
      </Alert>
      <div className="flex items-start gap-3">
        <Checkbox id="codes-saved" checked={saved} onCheckedChange={(v) => setSaved(v === true)} className="mt-0.5" />
        <Label htmlFor="codes-saved" className="text-sm leading-snug font-normal">
          {t.auth.codesSaved}
        </Label>
      </div>
      <Button size="lg" className="w-full" disabled={!saved} onClick={onDone}>
        {t.auth.codesContinue}
      </Button>
    </div>
  )
}
