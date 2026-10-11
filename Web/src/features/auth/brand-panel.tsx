import { Activity, MapPinned, ShieldCheck } from 'lucide-react'

import { LogoMark } from '@/components/brand/logo'
import { t } from '@/i18n'

const features = [
  {
    icon: ShieldCheck,
    title: 'Validation des gérants',
    body: 'Dossiers IFU, justificatifs chiffrés, décisions auditées.',
  },
  { icon: Activity, title: 'Fraîcheur des stocks', body: 'Saisies à moins de 8 h, rappels aux gérants inactifs.' },
  { icon: MapPinned, title: 'Zones en pénurie', body: 'Cellules anonymes, jamais une position personnelle.' },
]

/** Panneau de marque de l'écran de connexion (≥ 1024 px). Toujours sombre, dans les deux thèmes. */
export function BrandPanel() {
  return (
    <section
      aria-label={t.app.name}
      className="relative hidden overflow-hidden border-r border-white/8 bg-[oklch(0.17_0.012_45)] text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-14"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_15%_10%,oklch(0.58_0.19_39/0.55),transparent_70%),radial-gradient(50%_45%_at_90%_95%,oklch(0.7_0.195_46/0.25),transparent_70%)]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-[radial-gradient(circle,oklch(1_0_0/0.07)_1px,transparent_1.2px)] bg-size-[24px_24px]"
      />
      <RouteMap />
      <div className="relative flex items-center gap-3">
        <LogoMark className="size-10" />
        <div className="flex flex-col leading-tight">
          <span className="text-base font-semibold tracking-tight">GoStation</span>
          <span className="text-xs text-neutral-300">Administration · Bénin</span>
        </div>
      </div>

      <div className="relative flex max-w-md flex-col gap-8">
        <div className="flex flex-col gap-3">
          <p className="text-3xl leading-tight font-semibold tracking-tight text-balance xl:text-4xl">
            {t.auth.tagline}
          </p>
          <p className="text-sm text-pretty text-neutral-300">{t.auth.pitch}</p>
        </div>
        <ul className="flex flex-col gap-4">
          {features.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/8 ring-1 ring-white/12">
                <Icon className="size-4 text-brand-300" aria-hidden />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{title}</span>
                <span className="text-xs text-neutral-400">{body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-2xs text-neutral-400">© {new Date().getFullYear()} GoStation · Cotonou, Bénin</p>
    </section>
  )
}

/**
 * Réseau routier stylisé : grille de points, itinéraire, stations (décoratif). Il occupe la
 * moitié basse et droite du panneau, et s'efface sous les textes (masque).
 */
function RouteMap() {
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute right-0 bottom-0 h-[58%] w-[78%] opacity-90"
      preserveAspectRatio="xMaxYMax meet"
      viewBox="120 260 480 540"
    >
      <defs>
        <linearGradient id="gs-route" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="oklch(0.765 0.17 54)" stopOpacity="0.15" />
          <stop offset="0.6" stopColor="oklch(0.765 0.17 54)" stopOpacity="0.9" />
          <stop offset="1" stopColor="oklch(0.84 0.128 64)" stopOpacity="0.5" />
        </linearGradient>
      </defs>
      <path
        d="M180 820 C 260 720, 330 700, 400 640 S 470 520, 520 470 S 590 380, 640 360"
        fill="none"
        stroke="white"
        strokeOpacity="0.07"
        strokeWidth="18"
        strokeLinecap="round"
      />
      <path
        d="M180 820 C 260 720, 330 700, 400 640 S 470 520, 520 470 S 590 380, 640 360"
        fill="none"
        stroke="url(#gs-route)"
        strokeWidth="2.5"
        strokeDasharray="2 10"
        strokeLinecap="round"
      />
      <path
        d="M330 820 C 380 760, 470 740, 520 690 S 590 600, 640 590"
        fill="none"
        stroke="white"
        strokeOpacity="0.05"
        strokeWidth="12"
      />
      {[
        [400, 640],
        [520, 470],
        [520, 690],
      ].map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <circle r="22" fill="oklch(0.7 0.195 46)" fillOpacity="0.14" />
          <circle r="7" fill="oklch(0.7 0.195 46)" stroke="oklch(0.26 0.075 36)" strokeWidth="3" />
        </g>
      ))}
    </svg>
  )
}
