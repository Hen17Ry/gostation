import { Link } from '@tanstack/react-router'
import { ArrowLeft, Bell, Download, Flag, Fuel, Plus, Search, Trash2 } from 'lucide-react'
import { domAnimation, LazyMotion, m, MotionConfig } from 'motion/react'
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { toast } from 'sonner'

import { ApiError } from '@/api/errors'
import { Logo } from '@/components/brand/logo'
import { EmptyState } from '@/components/feedback/empty-state'
import { ErrorState } from '@/components/feedback/error-state'
import {
  ComingSoonIllustration,
  EmptyChartIllustration,
  ErrorIllustration,
  NoShortageIllustration,
  NotFoundIllustration,
} from '@/components/feedback/illustrations'
import { Field } from '@/components/form/field'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '@/components/ui/input-otp'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Delta, KpiCard } from '@/features/dashboard/kpi-card'
import { contrast, parseColor, toHex } from '@/lib/color'
import { formatAxis, formatInteger, formatPercent } from '@/lib/format'
import { useTheme } from '@/lib/theme'
import { cn } from '@/lib/utils'

/**
 * Page /design (développement uniquement) : tous les tokens et composants de l'admin, dans le
 * thème courant. Les contrastes sont mesurés en direct sur les couleurs calculées par le navigateur.
 * Référence écrite : Web/docs/design-system.md.
 */
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

const sections = [
  ['couleurs', 'Couleurs'],
  ['semantique', 'Rôles sémantiques'],
  ['donnees', 'Données'],
  ['typographie', 'Typographie'],
  ['espaces', 'Espacements et rayons'],
  ['elevations', 'Élévations'],
  ['mouvement', 'Mouvement'],
  ['etats', 'États'],
  ['composants', 'Composants'],
] as const

/** Lit la couleur calculée d'une variable CSS (re-mesurée à chaque changement de thème). */
function useCssColors(vars: readonly string[]) {
  const { resolved } = useTheme()
  const probe = useRef<HTMLSpanElement>(null)
  const [colors, setColors] = useState<Record<string, string>>({})
  useLayoutEffect(() => {
    const el = probe.current
    if (!el) return
    const out: Record<string, string> = {}
    for (const v of vars) {
      el.style.color = `var(${v})`
      out[v] = getComputedStyle(el).color
    }
    setColors(out)
  }, [vars, resolved])
  return { colors, probe: <span ref={probe} aria-hidden className="hidden" /> }
}

function ratio(fg?: string, bg?: string) {
  const a = fg ? parseColor(fg) : null
  const b = bg ? parseColor(bg) : null
  return a && b ? contrast(a, b) : null
}

function RatioBadge({ value, min }: { value: number | null; min: number }) {
  if (value === null) return <Badge variant="secondary">—</Badge>
  const ok = value >= min
  return (
    <Badge variant={ok ? 'success' : 'danger'} title={`Seuil ${min}:1`}>
      {value.toFixed(2)}:1 {ok ? 'AA' : '✗'}
    </Badge>
  )
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-20 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        {description && <p className="max-w-3xl text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  )
}

// Listes figées au niveau du module : la mesure ne se relance qu'au changement de thème.
const REFERENCES = ['--color-white', '--color-neutral-950']
const brandVars = STEPS.map((s) => `--color-brand-${s}`)
const neutralVars = STEPS.map((s) => `--color-neutral-${s}`)
const brandProbe = [...brandVars, ...REFERENCES]
const neutralProbe = [...neutralVars, ...REFERENCES]

function Palette({ name, vars, probeVars }: { name: string; vars: string[]; probeVars: string[] }) {
  const { colors, probe } = useCssColors(probeVars)
  return (
    <div className="flex flex-col gap-2">
      {probe}
      <h3 className="text-sm font-medium">{name}</h3>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6 xl:grid-cols-11">
        {vars.map((v, i) => {
          const c = colors[v]
          const parsed = c ? parseColor(c) : null
          return (
            <li key={v} className="flex flex-col gap-1.5">
              <span
                className="h-14 rounded-lg ring-1 ring-black/5 ring-inset dark:ring-white/10"
                style={{ background: `var(${v})` }}
              />
              <span className="text-2xs font-medium">{STEPS[i]}</span>
              <span className="font-mono text-2xs text-muted-foreground">{parsed ? toHex(parsed) : '…'}</span>
              <span className="text-2xs text-muted-foreground tabular-nums">
                ◻ {ratio(colors['--color-white'], c)?.toFixed(1)} · ◼{' '}
                {ratio(colors['--color-neutral-950'], c)?.toFixed(1)}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// [libellé, texte, fond, seuil]
const roles: [string, string, string, number][] = [
  ['Fond de page', '--foreground', '--background', 4.5],
  ['Carte', '--card-foreground', '--card', 4.5],
  ['Primaire', '--primary-foreground', '--primary', 4.5],
  ['Primaire survolé', '--primary-foreground', '--primary-hover', 4.5],
  ['Primaire teinté', '--primary-subtle-foreground', '--primary-subtle', 4.5],
  ['Texte de marque', '--brand-text', '--card', 4.5],
  ['Secondaire', '--secondary-foreground', '--secondary', 4.5],
  ['Atténué', '--muted-foreground', '--muted', 4.5],
  ['Atténué sur carte', '--muted-foreground', '--card', 4.5],
  ['Danger', '--destructive-foreground', '--destructive', 4.5],
  ['Danger en texte', '--destructive', '--card', 4.5],
  ['Succès teinté', '--success-subtle-foreground', '--success-subtle', 4.5],
  ['Alerte teintée', '--warning-subtle-foreground', '--warning-subtle', 4.5],
  ['Danger teinté', '--danger-subtle-foreground', '--danger-subtle', 4.5],
  ['Info teintée', '--info-subtle-foreground', '--info-subtle', 4.5],
  ['Barre latérale', '--sidebar-foreground', '--sidebar', 4.5],
  ['Anneau de focus', '--ring', '--background', 3],
  ['Bordure de champ', '--input', '--card', 3],
]

const roleVars = [...new Set(roles.flatMap(([, fg, bg]) => [fg, bg]))]

function SemanticRoles() {
  const { colors, probe } = useCssColors(roleVars)
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {probe}
      {roles.map(([label, fg, bg, min]) => (
        <div key={label} className="flex items-center gap-3 rounded-lg border bg-card p-2.5">
          <span
            className="grid size-11 shrink-0 place-items-center rounded-md text-sm font-semibold ring-1 ring-border"
            style={{ color: `var(${fg})`, background: `var(${bg})` }}
          >
            {min === 3 ? '◎' : 'Aa'}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs font-medium">{label}</span>
            <span className="truncate font-mono text-2xs text-muted-foreground">
              {fg} / {bg}
            </span>
          </span>
          <RatioBadge value={ratio(colors[fg], colors[bg])} min={min} />
        </div>
      ))}
    </div>
  )
}

const demoProducts = ['Gaz 5 kg', 'Gaz 10 kg', 'Gaz 25 kg', 'Essence', 'Gasoil']
const demoRows = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map((d, i) => ({
  d,
  ...Object.fromEntries(demoProducts.map((_, j) => [`p${j}`, 800 + ((i * 7 + j * 13) % 9) * 140])),
}))
const demoConfig = Object.fromEntries(
  demoProducts.map((p, j) => [`p${j}`, { label: p, color: `var(--chart-${j + 1})` }]),
) satisfies ChartConfig

function MotionDemo() {
  const [on, setOn] = useState(false)
  const rows = [
    ['Rapide · 120 ms', 'var(--duration-fast)', 'var(--ease-out)'],
    ['Standard · 200 ms', 'var(--duration-base)', 'var(--ease-out)'],
    ['Emphase · 320 ms', 'var(--duration-slow)', 'var(--ease-in-out)'],
  ] as const
  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        {rows.map(([label, duration, easing]) => (
          <div key={label} className="flex items-center gap-4">
            <span className="w-40 text-xs text-muted-foreground">{label}</span>
            <div className="relative h-6 flex-1 rounded-full bg-muted">
              <span
                className="absolute top-1 left-1 size-4 rounded-full bg-primary"
                style={{
                  transform: on ? 'translateX(calc(min(60vw, 520px)))' : 'translateX(0)',
                  transition: `transform ${duration} ${easing}`,
                }}
              />
            </div>
          </div>
        ))}
        <Button variant="outline" size="sm" className="self-start" onClick={() => setOn((v) => !v)}>
          Rejouer
        </Button>
        <p className="text-2xs text-muted-foreground">
          Transform et opacité uniquement. Avec « réduire les animations », les durées tombent à zéro.
        </p>
      </CardContent>
    </Card>
  )
}

export default function DesignPage() {
  const [otp, setOtp] = useState('12')
  const [segment, setSegment] = useState('7d')
  useEffect(() => {
    document.title = 'Design system · GoStation'
  }, [])

  return (
    <TooltipProvider>
      <MotionConfig reducedMotion="user">
        <LazyMotion features={domAnimation} strict>
          <div className="min-h-dvh">
            <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/90 px-4 backdrop-blur-sm sm:px-6">
              <Logo />
              <Badge variant="brand">Design system</Badge>
              <Badge variant="outline">dev</Badge>
              <div className="ml-auto flex items-center gap-2">
                <Button asChild variant="ghost" size="sm">
                  <Link to="/">
                    <ArrowLeft aria-hidden />
                    Application
                  </Link>
                </Button>
                <ThemeToggle />
              </div>
            </header>
            <div className="mx-auto grid max-w-[1440px] gap-10 px-4 py-8 sm:px-6 lg:grid-cols-[180px_minmax(0,1fr)]">
              <nav aria-label="Sections" className="hidden lg:block">
                <ul className="sticky top-20 flex flex-col gap-1 text-xs">
                  {sections.map(([id, label]) => (
                    <li key={id}>
                      <a
                        href={`#${id}`}
                        className="block rounded-md px-2 py-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
              <main className="flex min-w-0 flex-col gap-12">
                <div className="flex flex-col gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight">Design system GoStation</h1>
                  <p className="max-w-3xl text-sm text-muted-foreground">
                    Back-office premium, épuré, dense mais aéré. Tokens en variables CSS (src/styles/globals.css)
                    exposés au thème Tailwind ; les composants n’emploient que les rôles sémantiques. Basculez le thème
                    pour vérifier le mode sombre : chaque rôle y est choisi, pas inversé.
                  </p>
                </div>

                <Section
                  id="couleurs"
                  title="Couleurs"
                  description="Palette orange complète (flamme → braise) et neutres légèrement chauds. Contrastes affichés : ◻ texte blanc, ◼ texte presque noir."
                >
                  <Palette name="Orange GoStation (brand)" vars={brandVars} probeVars={brandProbe} />
                  <Palette name="Neutres" vars={neutralVars} probeVars={neutralProbe} />
                </Section>

                <Section
                  id="semantique"
                  title="Rôles sémantiques"
                  description="Couples texte / fond mesurés en direct dans le thème courant : 4,5:1 pour le texte, 3:1 pour l’anneau de focus et la bordure des champs (WCAG 2.2 AA). Le test src/styles/tokens.test.ts vérifie les deux thèmes."
                >
                  <SemanticRoles />
                </Section>

                <Section
                  id="donnees"
                  title="Données"
                  description="Séries catégorielles dans un ordre fixe (la couleur suit le produit, jamais son rang), validées pour la vision des couleurs. Les statuts sont réservés et toujours accompagnés d’une icône et d’un libellé."
                >
                  <div className="flex flex-wrap gap-3">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <span key={n} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs">
                        <span className="size-4 rounded" style={{ background: `var(--chart-${n})` }} />
                        Série {n}
                      </span>
                    ))}
                    {(['good', 'warning', 'critical'] as const).map((s) => (
                      <span key={s} className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs">
                        <span className="size-4 rounded-full" style={{ background: `var(--status-${s})` }} />
                        Statut {s}
                      </span>
                    ))}
                  </div>
                  <Card>
                    <CardHeader>
                      <CardTitle>Recherches par produit (exemple)</CardTitle>
                      <CardDescription>Barres empilées, écart de 1 px, extrémité arrondie, info-bulle.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer config={demoConfig} className="aspect-auto h-56 w-full">
                        <BarChart data={demoRows} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                          <XAxis dataKey="d" tickLine={false} axisLine={false} tickMargin={8} />
                          <YAxis
                            tickLine={false}
                            axisLine={false}
                            width={44}
                            tickFormatter={(v: number) => formatAxis(v)}
                          />
                          <ChartTooltip content={<ChartTooltipContent />} />
                          {demoProducts.map((_, j) => (
                            <Bar
                              key={j}
                              dataKey={`p${j}`}
                              stackId="a"
                              fill={`var(--chart-${j + 1})`}
                              stroke="var(--card)"
                              strokeWidth={1}
                              maxBarSize={28}
                              radius={j === demoProducts.length - 1 ? [4, 4, 0, 0] : 0}
                              isAnimationActive={false}
                            />
                          ))}
                        </BarChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>
                </Section>

                <Section
                  id="typographie"
                  title="Typographie"
                  description="Geist (interface) et Geist Mono (codes, identifiants), auto-hébergées. Corps d’interface 14 px, chiffres tabulaires pour toute comparaison."
                >
                  <Card>
                    <CardContent className="flex flex-col gap-3">
                      {(
                        [
                          ['text-3xl', '30 px · titres de marque'],
                          ['text-2xl', '24 px · valeurs d’indicateurs'],
                          ['text-xl', '20 px · titre de page'],
                          ['text-base', '16 px · titres de carte, champs mobiles'],
                          ['text-sm', '14 px · interface'],
                          ['text-xs', '13 px · descriptions'],
                          ['text-2xs', '12 px · légendes, minimum'],
                        ] as const
                      ).map(([cls, label]) => (
                        <div key={cls} className="flex items-baseline gap-4 border-b pb-2 last:border-0 last:pb-0">
                          <span className="w-56 shrink-0 font-mono text-2xs text-muted-foreground">{label}</span>
                          <span className={cn(cls, 'truncate font-semibold tracking-tight')}>
                            Stations en stock à Cotonou
                          </span>
                        </div>
                      ))}
                      <p className="font-mono text-sm">Geist Mono · K7QD-M2XA-PL4R-ZC3T · 8758a1c12ffffff</p>
                      <p className="text-sm tabular-nums">Chiffres tabulaires : 1 111 · 278 327 · 14 %</p>
                    </CardContent>
                  </Card>
                </Section>

                <Section
                  id="espaces"
                  title="Espacements et rayons"
                  description="Grille de 4 px. Cartes : 20 px de marge interne, 12 à 24 px entre blocs. Rayons de 4 à 18 px."
                >
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                      <CardContent className="flex flex-col gap-2">
                        {[1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map((n) => (
                          <div key={n} className="flex items-center gap-3">
                            <span className="w-16 font-mono text-2xs text-muted-foreground">
                              {n} · {n * 4}px
                            </span>
                            <span
                              className="h-3 rounded-sm bg-primary/70"
                              style={{ width: `calc(var(--spacing) * ${n})` }}
                            />
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                    <Card>
                      <CardContent className="flex flex-wrap gap-4">
                        {[
                          'rounded-xs',
                          'rounded-sm',
                          'rounded-md',
                          'rounded-lg',
                          'rounded-xl',
                          'rounded-2xl',
                          'rounded-full',
                        ].map((r) => (
                          <div key={r} className="flex flex-col items-center gap-1.5">
                            <span className={cn('size-14 border-2 border-primary bg-primary-subtle', r)} />
                            <span className="font-mono text-2xs text-muted-foreground">{r}</span>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  </div>
                </Section>

                <Section
                  id="elevations"
                  title="Élévations"
                  description="0 à plat (fond), 1 cartes, 2 menus et info-bulles, 3 dialogues. En sombre, l’élévation passe aussi par une surface plus claire."
                >
                  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {[
                      ['Niveau 0', ''],
                      ['Niveau 1 · cartes', 'shadow-elevation-1'],
                      ['Niveau 2 · menus', 'shadow-elevation-2 bg-popover'],
                      ['Niveau 3 · dialogues', 'shadow-elevation-3 bg-popover'],
                    ].map(([label, cls]) => (
                      <div
                        key={label}
                        className={cn(
                          'grid h-24 place-items-center rounded-xl border bg-card text-xs font-medium',
                          cls,
                        )}
                      >
                        {label}
                      </div>
                    ))}
                  </div>
                </Section>

                <Section
                  id="mouvement"
                  title="Mouvement"
                  description="Entrées en ease-out, sorties plus courtes. Repli de la barre latérale en transform (FLIP), apparition des blocs en fondu décalé."
                >
                  <MotionDemo />
                  <div className="flex gap-3">
                    {[0, 1, 2, 3].map((i) => (
                      <m.span
                        key={i}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.32, delay: i * 0.05, ease: [0.23, 1, 0.32, 1] }}
                        className="h-12 flex-1 rounded-lg bg-primary-subtle"
                      />
                    ))}
                  </div>
                </Section>

                <Section
                  id="etats"
                  title="États"
                  description="Survol, focus visible (anneau 2 px décalé), désactivé, chargement, vide et erreur. Les états survol et focus réels se testent à la souris et au clavier (Tab)."
                >
                  <Card>
                    <CardContent className="flex flex-col gap-5">
                      <StateRow label="Boutons">
                        <Button>Valider</Button>
                        <Button className="ring-2 ring-ring ring-offset-2 ring-offset-background">Focus</Button>
                        <Button disabled>Désactivé</Button>
                        <Button loading>Enregistrement…</Button>
                      </StateRow>
                      <StateRow label="Champs">
                        <Input placeholder="Valeur" className="w-48" />
                        <Input defaultValue="Focus" className="w-48 border-ring ring-2 ring-ring/30" />
                        <Input defaultValue="Erreur" aria-invalid className="w-48" />
                        <Input defaultValue="Désactivé" disabled className="w-48" />
                      </StateRow>
                      <StateRow label="Chargement">
                        <div className="flex w-72 flex-col gap-2">
                          <Skeleton className="h-4 w-40" />
                          <Skeleton className="h-8 w-full" />
                          <Skeleton className="h-4 w-56" />
                        </div>
                      </StateRow>
                    </CardContent>
                  </Card>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card>
                      <EmptyState
                        illustration={<EmptyChartIllustration />}
                        title="Aucune recherche sur cette période"
                        description="Les recherches apparaîtront ici dès que l’app mobile sera utilisée."
                        action={
                          <Button size="sm" variant="outline">
                            Changer de période
                          </Button>
                        }
                      />
                    </Card>
                    <Card>
                      <ErrorState
                        error={
                          new ApiError({
                            status: 503,
                            code: 'service.unavailable',
                            requestId: '01929b3e-7c41-7d2a-9f1e-3b8c2d4a5e6f',
                          })
                        }
                        onRetry={() => toast.info('Nouvel essai')}
                      />
                    </Card>
                  </div>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
                    {[
                      [EmptyChartIllustration, 'Graphique vide'],
                      [NoShortageIllustration, 'Aucune pénurie'],
                      [ComingSoonIllustration, 'À venir'],
                      [ErrorIllustration, 'Erreur'],
                      [NotFoundIllustration, 'Introuvable'],
                    ].map(([Ill, label]) => {
                      const I = Ill as typeof EmptyChartIllustration
                      return (
                        <figure
                          key={label as string}
                          className="m-0 flex flex-col items-center gap-2 rounded-xl border bg-card p-4"
                        >
                          <I />
                          <figcaption className="text-2xs text-muted-foreground">{label as string}</figcaption>
                        </figure>
                      )
                    })}
                  </div>
                </Section>

                <Section
                  id="composants"
                  title="Composants"
                  description="Primitives shadcn/ui et blocs adaptés de 21st.dev (barre latérale, cartes d’indicateurs, carte de graphique, état vide), harmonisés avec les tokens."
                >
                  <div className="flex flex-wrap gap-2">
                    <Button>
                      <Plus aria-hidden />
                      Primaire
                    </Button>
                    <Button variant="secondary">Secondaire</Button>
                    <Button variant="outline">
                      <Download aria-hidden />
                      Contour
                    </Button>
                    <Button variant="ghost">Discret</Button>
                    <Button variant="destructive">
                      <Trash2 aria-hidden />
                      Supprimer
                    </Button>
                    <Button variant="link">Lien</Button>
                    <Button size="sm">Petit</Button>
                    <Button size="lg">Grand</Button>
                    <Button size="icon" variant="outline" aria-label="Rechercher">
                      <Search aria-hidden />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge>Défaut</Badge>
                    <Badge variant="brand">Marque</Badge>
                    <Badge variant="secondary">Secondaire</Badge>
                    <Badge variant="outline">Contour</Badge>
                    <Badge variant="success">Approuvée</Badge>
                    <Badge variant="warning">En attente</Badge>
                    <Badge variant="danger">Suspendue</Badge>
                    <Badge variant="info">Info</Badge>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    <Alert variant="info">
                      <Bell aria-hidden />
                      <AlertTitle>Information</AlertTitle>
                      <AlertDescription>Votre session a expiré. Reconnectez-vous.</AlertDescription>
                    </Alert>
                    <Alert variant="success">
                      <Bell aria-hidden />
                      <AlertDescription>Vous êtes déconnecté.</AlertDescription>
                    </Alert>
                    <Alert variant="warning">
                      <Bell aria-hidden />
                      <AlertDescription>Conservez vos codes de secours hors ligne.</AlertDescription>
                    </Alert>
                    <Alert variant="destructive">
                      <Bell aria-hidden />
                      <AlertTitle>Compte désactivé</AlertTitle>
                      <AlertDescription>Contactez un autre administrateur.</AlertDescription>
                    </Alert>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <KpiCard
                      label="Recherches"
                      kpi={{ value: 278327, previous: 269400, change: 0.033 }}
                      format={formatInteger}
                      icon={<Search />}
                      trend={[4, 6, 5, 7, 6, 8, 9]}
                    />
                    <KpiCard
                      label="Sans station à 5 km"
                      kpi={{ value: 0.14, previous: 0.135, change: 0.037 }}
                      format={formatPercent}
                      good="down"
                      icon={<Fuel />}
                    />
                    <KpiCard
                      label="Signalements reçus"
                      kpi={{ value: 12, previous: 20, change: -0.4 }}
                      format={formatInteger}
                      good="down"
                      icon={<Flag />}
                    />
                    <KpiCard
                      label="Nouveaux gérants"
                      kpi={{ value: 2, previous: 0, change: null }}
                      format={formatInteger}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <Delta change={0.25} good="up" />
                    <Delta change={-0.12} good="up" />
                    <Delta change={0} good="up" />
                  </div>
                  <Card>
                    <CardHeader>
                      <CardTitle>Tableau</CardTitle>
                      <CardDescription>Dense, chiffres alignés à droite, en-têtes discrets.</CardDescription>
                    </CardHeader>
                    <CardContent className="px-0">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="pl-5">Station</TableHead>
                            <TableHead>Statut</TableHead>
                            <TableHead className="pr-5 text-right">Stock (L)</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {[
                            ['Station Akpakpa', 'success', 'Approuvée', 12400],
                            ['Station Godomey', 'warning', 'En attente', 0],
                            ['Station Parakou Centre', 'danger', 'Suspendue', 3800],
                          ].map(([name, v, label, qty]) => (
                            <TableRow key={name as string}>
                              <TableCell className="pl-5 font-medium">{name as string}</TableCell>
                              <TableCell>
                                <Badge variant={v as 'success'}>{label as string}</Badge>
                              </TableCell>
                              <TableCell className="pr-5 text-right tabular-nums">
                                {formatInteger(qty as number)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                  <div className="flex flex-wrap items-start gap-6">
                    <Field label="Champ avec aide" hint="12 caractères au plus.">
                      {(p) => <Input {...p} placeholder="Ouidah" className="w-64" />}
                    </Field>
                    <Field label="Champ en erreur" error="Saisissez l'adresse email.">
                      {(p) => <Input {...p} className="w-64" />}
                    </Field>
                    <div className="flex flex-col gap-1.5">
                      <Label>Code à 6 chiffres</Label>
                      <InputOTP maxLength={6} value={otp} onChange={setOtp} aria-label="Code de démonstration">
                        <InputOTPGroup>
                          {[0, 1, 2].map((i) => (
                            <InputOTPSlot key={i} index={i} />
                          ))}
                        </InputOTPGroup>
                        <InputOTPSeparator />
                        <InputOTPGroup>
                          {[3, 4, 5].map((i) => (
                            <InputOTPSlot key={i} index={i} />
                          ))}
                        </InputOTPGroup>
                      </InputOTP>
                    </div>
                    <div className="flex items-center gap-2 pt-6">
                      <Checkbox id="demo-check" defaultChecked />
                      <Label htmlFor="demo-check" className="font-normal">
                        Case à cocher
                      </Label>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <ToggleGroup
                      type="single"
                      variant="segmented"
                      spacing={0.5}
                      size="sm"
                      value={segment}
                      onValueChange={(v) => v && setSegment(v)}
                      aria-label="Contrôle segmenté"
                    >
                      {['24h', '7d', '30d'].map((v) => (
                        <ToggleGroupItem key={v} value={v} className="h-7 px-3">
                          {v.replace('d', ' j').replace('h', ' h')}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="outline" size="sm">
                          Info-bulle
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Niveau d’élévation 2</TooltipContent>
                    </Tooltip>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm">
                          Menu
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem>Approuver</DropdownMenuItem>
                        <DropdownMenuItem>Suspendre</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive">Refuser</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          Dialogue
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Suspendre la station ?</DialogTitle>
                          <DialogDescription>
                            Le gérant reçoit un email avec le motif. La station sort de la recherche.
                          </DialogDescription>
                        </DialogHeader>
                        <Field label="Motif">{(p) => <Input {...p} placeholder="Contrôle en cours" />}</Field>
                        <DialogFooter>
                          <DialogClose asChild>
                            <Button variant="outline">Annuler</Button>
                          </DialogClose>
                          <Button variant="destructive">Suspendre</Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toast.success('Station approuvée', { description: 'Email envoyé au gérant.' })}
                    >
                      Toast succès
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        toast.error('Action impossible', {
                          description: 'Quelqu’un a modifié cette station entre-temps.',
                        })
                      }
                    >
                      Toast erreur
                    </Button>
                  </div>
                </Section>
              </main>
            </div>
          </div>
        </LazyMotion>
      </MotionConfig>
    </TooltipProvider>
  )
}

function StateRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <span className="w-28 shrink-0 text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}
