/**
 * Messages d'erreur en français, par code stable de l'API (problem+json, ARCHITECTURE §5).
 * Le client ne montre jamais `title` ni `detail` (anglais, pour les développeurs).
 */
const byCode: Record<string, string> = {
  'request.invalid_json': 'La requête est mal formée. Rechargez la page puis réessayez.',
  'request.invalid_parameter': 'Un paramètre est invalide. Vérifiez les filtres puis réessayez.',
  'request.body_too_large': 'Les données envoyées sont trop volumineuses.',
  'request.validation_failed': 'Certains champs sont invalides.',
  'request.timeout': 'Le serveur a mis trop de temps à répondre. Réessayez.',
  'request.precondition_required': 'Cette ressource a changé. Rechargez-la puis réessayez.',
  'resource.version_conflict': 'Quelqu’un a modifié cette ressource entre-temps. Rechargez-la puis réessayez.',
  'resource.not_found': 'Cette ressource n’existe pas ou plus.',
  'resource.conflict': 'Cette action entre en conflit avec l’état actuel.',
  'route.not_found': 'Cette page de l’API n’existe pas.',
  'method.not_allowed': 'Action non autorisée sur cette ressource.',
  'auth.unauthorized': 'Votre session a expiré. Reconnectez-vous.',
  'auth.forbidden': 'Vous n’avez pas accès à cette fonction.',
  'auth.invalid_credentials': 'Email ou mot de passe incorrect.',
  'auth.invalid_mfa_token': 'La vérification a expiré. Reconnectez-vous.',
  'auth.invalid_second_factor': 'Code incorrect. Vérifiez l’heure de votre téléphone puis réessayez.',
  'auth.invalid_refresh_token': 'Votre session a expiré. Reconnectez-vous.',
  'auth.csrf_failed': 'Votre session n’est plus valide. Reconnectez-vous.',
  'auth.account_disabled': 'Ce compte a été désactivé. Contactez un autre administrateur pour le réactiver.',
  'rate_limit.exceeded': 'Trop de tentatives. Patientez avant de réessayer.',
  'service.unavailable': 'Le service est momentanément indisponible. Réessayez dans un instant.',
  'internal.error': 'Erreur inattendue du serveur. L’équipe technique peut la retrouver avec la référence.',
  'network.error': 'Connexion impossible. Vérifiez votre réseau puis réessayez.',
}

const byStatus: Record<number, string> = {
  400: byCode['request.invalid_parameter']!,
  401: byCode['auth.unauthorized']!,
  403: byCode['auth.forbidden']!,
  404: byCode['resource.not_found']!,
  409: byCode['resource.conflict']!,
  422: byCode['request.validation_failed']!,
  429: byCode['rate_limit.exceeded']!,
  503: byCode['service.unavailable']!,
}

/** Message d'erreur affichable pour un code stable (repli sur le statut HTTP). */
export function errorMessage(code: string | undefined, status?: number, retryAfterS?: number): string {
  if (code === 'rate_limit.exceeded' || status === 429) {
    return retryAfterS && retryAfterS > 0
      ? `Trop de tentatives. Réessayez dans ${formatWait(retryAfterS)}.`
      : byCode['rate_limit.exceeded']!
  }
  if (code && byCode[code]) return byCode[code]
  if (status && byStatus[status]) return byStatus[status]
  return byCode['internal.error']!
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} s`
  const min = Math.ceil(seconds / 60)
  return `${min} min`
}
