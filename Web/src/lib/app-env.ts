import { t } from '@/i18n'

/**
 * Environnement du serveur visé par ce build : VITE_APP_ENV, figé à la build de l'image du proxy
 * d'après APP_ENV (docker-compose.prod.yml). Le staging se signale partout (bandeau, badge, titre
 * d'onglet) pour ne jamais être pris pour la production.
 */
export function isStaging(): boolean {
  return import.meta.env.VITE_APP_ENV === 'staging'
}

/** Titre d'onglet, préfixé en staging. */
export function pageTitle(title: string): string {
  return isStaging() ? `${t.env.staging} · ${title}` : title
}
