import { useNavigate } from '@tanstack/react-router'
import { ShieldCheck } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'

import type { AdminChallenge, AdminSession } from '@/api/schemas'
import { Logo } from '@/components/brand/logo'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { Skeleton } from '@/components/ui/skeleton'
import { t } from '@/i18n'

import { safeRedirect } from './api'
import { BrandPanel } from './brand-panel'
import { CredentialsStep } from './credentials-step'
import type { Notice } from './notice'

// Étapes 2FA (input-otp, QR code, codes de secours) : chunk à part, préchargé dès que l'admin
// commence à saisir ; il est prêt quand l'API demande le code.
const loadSteps = () => import('./steps')
const TotpStep = lazy(() => loadSteps().then((m) => ({ default: m.TotpStep })))
const RecoveryStep = lazy(() => loadSteps().then((m) => ({ default: m.RecoveryStep })))
const SetupStep = lazy(() => loadSteps().then((m) => ({ default: m.SetupStep })))
const RecoveryCodesStep = lazy(() => loadSteps().then((m) => ({ default: m.RecoveryCodesStep })))

type Challenge = { challenge: AdminChallenge; email: string; expiresAt: number }
type Step =
  | { kind: 'credentials'; notice?: Notice; email?: string }
  | ({ kind: 'totp' } & Challenge)
  | ({ kind: 'recovery' } & Challenge)
  | ({ kind: 'setup'; setup: { secret: string; otpauthUri: string } } & Challenge)
  | { kind: 'codes'; codes: string[]; email: string; firstName: string }

export type LoginReason = 'expired' | 'signed-out'

function initialNotice(reason?: LoginReason): Notice | undefined {
  if (reason === 'expired') return { variant: 'info', body: t.auth.sessionExpired }
  if (reason === 'signed-out') return { variant: 'success', body: t.auth.signedOut }
  return undefined
}

/**
 * Connexion admin en deux temps : mot de passe, puis 2FA (code TOTP ou code de secours). À la
 * première connexion : QR code, vérification d'un code, puis les 10 codes de secours à sauvegarder.
 */
export function LoginPage({ redirect, reason }: { redirect?: string; reason?: LoginReason }) {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>({ kind: 'credentials', notice: initialNotice(reason) })

  useEffect(() => {
    document.title = `${t.auth.signInTitle} · ${t.app.name}`
  }, [])

  function finish(firstName: string) {
    void import('sonner').then(({ toast }) => toast.success(t.auth.welcome(firstName)))
    void navigate({ href: safeRedirect(redirect), replace: true })
  }

  function onChallenge(challenge: AdminChallenge, email: string) {
    const base = { challenge, email, expiresAt: Date.now() + challenge.expiresIn * 1000 }
    setStep(
      challenge.twoFactor === 'setup_required' && challenge.setup
        ? { kind: 'setup', setup: challenge.setup, ...base }
        : { kind: 'totp', ...base },
    )
  }

  function onSession(session: AdminSession, email: string) {
    if (session.recoveryCodes?.length) {
      setStep({ kind: 'codes', codes: session.recoveryCodes, email, firstName: session.user.firstName })
    } else {
      finish(session.user.firstName)
    }
  }

  function restart(message: string, email?: string) {
    setStep({ kind: 'credentials', notice: { variant: 'destructive', body: message }, email })
  }

  let content: React.ReactNode
  switch (step.kind) {
    case 'credentials':
      content = <CredentialsStep notice={step.notice} defaultEmail={step.email} onChallenge={onChallenge} />
      break
    case 'totp':
    case 'recovery': {
      const shared = {
        challenge: step.challenge,
        expiresAt: step.expiresAt,
        onSession: (s: AdminSession) => onSession(s, step.email),
        onRestart: (msg: string) => restart(msg, step.email),
        onBack: () => setStep({ kind: 'credentials', email: step.email }),
      }
      content =
        step.kind === 'totp' ? (
          <TotpStep {...shared} onUseRecovery={() => setStep({ ...step, kind: 'recovery' })} />
        ) : (
          <RecoveryStep {...shared} onUseTotp={() => setStep({ ...step, kind: 'totp' })} />
        )
      break
    }
    case 'setup':
      content = (
        <SetupStep
          challenge={step.challenge}
          setup={step.setup}
          expiresAt={step.expiresAt}
          onSession={(s) => onSession(s, step.email)}
          onRestart={(msg) => restart(msg, step.email)}
          onBack={() => setStep({ kind: 'credentials', email: step.email })}
        />
      )
      break
    case 'codes':
      content = <RecoveryCodesStep codes={step.codes} email={step.email} onDone={() => finish(step.firstName)} />
      break
  }

  const wide = step.kind === 'setup' || step.kind === 'codes'
  return (
    <>
      <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <BrandPanel />
        <main className="flex min-w-0 flex-col px-5 py-6 sm:px-10">
          <div className="flex items-center justify-between">
            <Logo className="lg:invisible" />
            <ThemeToggle />
          </div>
          <div className="flex flex-1 items-center justify-center py-10">
            <div className={wide ? 'w-full max-w-[460px]' : 'w-full max-w-[380px]'}>
              {/* Entrée de chaque étape en CSS (opacité + translation) : pas de bibliothèque
                  d'animation sur l'écran de connexion, premier rendu plus léger. */}
              <div key={step.kind} className={step.kind === 'credentials' ? undefined : 'animate-step-in'}>
                {/* Première saisie (le champ reçoit le focus dès l'affichage) : préchargement des étapes 2FA. */}
                <div onInputCapture={step.kind === 'credentials' ? () => void loadSteps() : undefined}>
                  <Suspense fallback={<StepSkeleton />}>{content}</Suspense>
                </div>
              </div>
            </div>
          </div>
          <p className="flex items-center justify-center gap-1.5 text-center text-2xs text-muted-foreground">
            <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
            {t.auth.secureNote}
          </p>
        </main>
      </div>
    </>
  )
}

function StepSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label={t.app.loading}>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  )
}
