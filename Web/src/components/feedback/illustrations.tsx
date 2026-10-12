/**
 * Illustrations des états vides et d'erreur : SVG en ligne (aucune requête), dessinés avec les
 * tokens (surface, bordure, orange de marque) pour suivre le thème clair ou sombre. Décoratives :
 * le titre et le texte de l'état portent le sens (aria-hidden).
 */
type IllustrationProps = { className?: string }

const frame = 'h-24 w-30 shrink-0'

function Backdrop() {
  return (
    <>
      <ellipse cx="60" cy="86" rx="40" ry="5" className="fill-foreground/5" />
      <circle cx="60" cy="46" r="38" className="fill-primary-subtle" />
    </>
  )
}

/** Graphique sans données : barres en pointillés. */
export function EmptyChartIllustration({ className = frame }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 96" className={className} aria-hidden fill="none">
      <Backdrop />
      <rect
        x="28"
        y="22"
        width="64"
        height="50"
        rx="8"
        className="fill-surface stroke-border-strong"
        strokeWidth="1.5"
      />
      <path d="M38 62h44" className="stroke-border-strong" strokeWidth="1.5" strokeLinecap="round" />
      {[40, 52, 64, 76].map((x, i) => (
        <rect
          key={x}
          x={x - 3}
          y={62 - [12, 22, 16, 28][i]!}
          width="6"
          height={[12, 22, 16, 28][i]}
          rx="2"
          className="stroke-primary"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
      ))}
      <circle cx="88" cy="24" r="9" className="fill-primary" />
      <path d="M84.5 24h7" className="stroke-primary-foreground" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

/** Carte sans pénurie : épingle de station validée. */
export function NoShortageIllustration({ className = frame }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 96" className={className} aria-hidden fill="none">
      <Backdrop />
      <path d="M22 66l22-8 32 8 22-8" className="stroke-border-strong" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M22 54l22-8 32 8 22-8" className="stroke-border" strokeWidth="1.5" strokeDasharray="2 4" />
      <path
        d="M60 18c-9 0-16 7-16 15.5C44 45 60 60 60 60s16-15 16-26.5C76 25 69 18 60 18Z"
        className="fill-primary stroke-primary"
        strokeWidth="1.5"
      />
      <path
        d="M54 33.5l4.2 4.2L66.5 29"
        className="stroke-primary-foreground"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Section en construction : route et cône. */
export function ComingSoonIllustration({ className = frame }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 96" className={className} aria-hidden fill="none">
      <Backdrop />
      <path
        d="M38 80l12-56h20l12 56"
        className="fill-surface stroke-border-strong"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M60 30v8M60 46v8M60 62v10" className="stroke-primary" strokeWidth="2.4" strokeLinecap="round" />
      <path d="M84 52l7 26H77l7-26Z" className="fill-primary" />
      <path d="M80.6 64h6.8" className="stroke-primary-foreground" strokeWidth="2" strokeLinecap="round" />
      <rect x="74" y="77" width="20" height="3" rx="1.5" className="fill-primary" />
    </svg>
  )
}

/** Erreur : connexion interrompue. */
export function ErrorIllustration({ className = frame }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 96" className={className} aria-hidden fill="none">
      <Backdrop />
      <rect
        x="26"
        y="24"
        width="68"
        height="46"
        rx="8"
        className="fill-surface stroke-border-strong"
        strokeWidth="1.5"
      />
      <path d="M26 34h68" className="stroke-border-strong" strokeWidth="1.5" />
      <circle cx="33" cy="29" r="1.6" className="fill-border-strong" />
      <circle cx="39" cy="29" r="1.6" className="fill-border-strong" />
      <path d="M44 54c4-6 11-9 16-9s12 3 16 9" className="stroke-border-strong" strokeWidth="2" strokeLinecap="round" />
      <path d="M53 59c2-2 4.5-3 7-3s5 1 7 3" className="stroke-border-strong" strokeWidth="2" strokeLinecap="round" />
      <circle cx="90" cy="66" r="11" className="fill-destructive" />
      <path
        d="M90 60.5v6.5M90 71v.5"
        className="stroke-destructive-foreground"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Page introuvable : itinéraire qui se perd. */
export function NotFoundIllustration({ className = frame }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 96" className={className} aria-hidden fill="none">
      <Backdrop />
      <path
        d="M24 72c14 0 14-18 28-18s10 18 24 10 4-26 20-30"
        className="stroke-primary"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeDasharray="4 5"
      />
      <circle cx="24" cy="72" r="5" className="fill-surface stroke-border-strong" strokeWidth="1.5" />
      <path
        d="M96 22c-5 0-9 4-9 8.6C87 37 96 45 96 45s9-8 9-14.4C105 26 101 22 96 22Z"
        className="fill-surface stroke-border-strong"
        strokeWidth="1.5"
      />
      <path
        d="M93.5 28.5c.3-1.4 1.3-2.2 2.6-2.2 1.5 0 2.5 1 2.5 2.2 0 1.8-2.5 1.9-2.5 3.6M96.1 35v.4"
        className="stroke-primary"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Liste vide : tableau aux lignes en pointillés et loupe. */
export function EmptyListIllustration({ className = frame }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 96" className={className} aria-hidden fill="none">
      <Backdrop />
      <rect
        x="26"
        y="20"
        width="60"
        height="54"
        rx="8"
        className="fill-surface stroke-border-strong"
        strokeWidth="1.5"
      />
      <path d="M26 32h60" className="stroke-border-strong" strokeWidth="1.5" />
      {[44, 54, 64].map((y) => (
        <path key={y} d={`M36 ${y}h40`} className="stroke-border-strong" strokeWidth="1.5" strokeDasharray="3 4" />
      ))}
      <circle cx="84" cy="62" r="11" className="fill-surface stroke-primary" strokeWidth="2" />
      <path d="M92 70l7 7" className="stroke-primary" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/** Rien à traiter : boîte de réception avec coche. */
export function AllClearIllustration({ className = frame }: IllustrationProps) {
  return (
    <svg viewBox="0 0 120 96" className={className} aria-hidden fill="none">
      <Backdrop />
      <path
        d="M30 52l8-26h44l8 26v16a6 6 0 0 1-6 6H36a6 6 0 0 1-6-6V52Z"
        className="fill-surface stroke-border-strong"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M30 52h18l4 7h16l4-7h18" className="stroke-border-strong" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="60" cy="38" r="11" className="fill-primary" />
      <path
        d="M55 38.2l3.4 3.4 6.6-6.8"
        className="stroke-primary-foreground"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
