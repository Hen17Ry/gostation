/** Configuration du site, figée au build (variables PUBLIC_*, voir .env.example). */
export const config = {
  siteUrl: (import.meta.env.PUBLIC_SITE_URL || 'https://gostation.bj').replace(/\/$/, ''),
  /** APK du build preview en staging ; Google Play plus tard. Vide : lien vers la section finale. */
  apkUrl: import.meta.env.PUBLIC_APK_URL || '',
  appEnv: import.meta.env.PUBLIC_APP_ENV || 'development',
} as const

/** Adresse du bouton « Télécharger l'app ». */
export const downloadHref = config.apkUrl || '#telecharger'

/** Seule la production est indexable (Caddy envoie aussi X-Robots-Tag hors production). */
export const indexable = config.appEnv === 'production'
