/**
 * Masquage des données personnelles avant tout envoi au suivi des plantages (D90), même règles que
 * le backend (internal/platform/errtrack) : emails, jetons, coordonnées, adresses IP, téléphones.
 */
const patterns: Array<[RegExp, string | ((m: string, ...g: string[]) => string)]> = [
  [/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, '[email]'],
  [/eyJ[\w-]+\.[\w-]+\.[\w-]*|\bgs[rm]_[\w-]+|ExponentPushToken\[[^\]]*\]|\bbearer\s+\S+/gi, '[token]'],
  [
    /\b(lat|lng|lon|latitude|longitude)(["']?\s*[:=]\s*["']?)-?\d+(?:\.\d+)?/gi,
    (_m, k: string, sep: string) => `${k}${sep}***`,
  ],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]'],
  // IPv6 : au moins trois groupes séparés par « : », ou « :: » (une heure 12:30:45 n'en est pas une).
  [/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b|\b(?:[0-9a-f]{1,4}:){1,6}:(?:[0-9a-f]{1,4}\b)?/gi, '[ip]'],
  [/-?\b\d{1,3}\.\d{4,}\b/g, '[coord]'],
  [/\+\d{8,15}\b/g, '[phone]'],
]

export function scrubText(text: string): string {
  return patterns.reduce<string>(
    (s, [re, by]) => s.replace(re, by as (substring: string, ...args: string[]) => string),
    text,
  )
}

/** Masque récursivement toutes les chaînes d'une valeur (objets et tableaux copiés). */
export function scrubDeep<T>(value: T): T {
  if (typeof value === 'string') return scrubText(value) as T
  if (Array.isArray(value)) return value.map((v: unknown) => scrubDeep(v)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v)])) as T
  }
  return value
}

/** Événement minimal du SDK (seuls les champs touchés ici). */
export interface ScrubbableEvent {
  request?: { url?: string }
  user?: unknown
  breadcrumbs?: unknown
}

/**
 * Retire l'utilisateur, le fil d'Ariane, la requête (sauf l'adresse de la page, sans paramètres ni
 * fragment : `?q=` et `?user=` peuvent porter un nom ou un email), puis masque tous les textes.
 */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  const { user: _user, breadcrumbs: _breadcrumbs, request, ...rest } = event
  const out = scrubDeep(rest) as E
  if (request?.url) {
    try {
      const u = new URL(request.url)
      ;(out as ScrubbableEvent).request = { url: `${u.origin}${u.pathname}` }
    } catch {
      // URL illisible : rien n'est gardé.
    }
  }
  return out
}
