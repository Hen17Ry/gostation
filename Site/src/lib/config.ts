/** Configuration du site, figée au build (variables PUBLIC_*, voir .env.example). */
export const config = {
  siteUrl: (import.meta.env.PUBLIC_SITE_URL || 'https://gostation.bj').replace(/\/$/, ''),
  /** APK du build preview en staging ; Google Play plus tard. Vide : lien vers la section finale. */
  apkUrl: import.meta.env.PUBLIC_APK_URL || '',
  appEnv: import.meta.env.PUBLIC_APP_ENV || 'development',
  /** Contact public (mailto) et WhatsApp (numéro international sans « + », vide : bouton masqué). */
  contactEmail: import.meta.env.PUBLIC_CONTACT_EMAIL || 'contact@gostation.bj',
  whatsappNumber: (import.meta.env.PUBLIC_WHATSAPP_NUMBER || '').replace(/\D/g, ''),
} as const

/** Adresse du bouton « Télécharger l'app ». */
export const downloadHref = config.apkUrl || '#telecharger'

/** Seule la production est indexable (Caddy envoie aussi X-Robots-Tag hors production). */
export const indexable = config.appEnv === 'production'

export const mailtoHref = `mailto:${config.contactEmail}?subject=${encodeURIComponent('GoStation : prise de contact')}`

/** Lien WhatsApp (wa.me) avec un premier message, ou null si aucun numéro n'est configuré. */
export const whatsappHref = config.whatsappNumber
  ? `https://wa.me/${config.whatsappNumber}?text=${encodeURIComponent('Bonjour GoStation, ')}`
  : null
