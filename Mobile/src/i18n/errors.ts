/**
 * Messages d'erreur en français, par code stable de l'API (problem+json). L'app ne montre jamais
 * `title` ni `detail` (anglais, pour les développeurs).
 */
const byCode: Record<string, string> = {
  'request.invalid_json': 'La requête est mal formée. Réessayez.',
  'request.invalid_parameter': 'Un paramètre est invalide.',
  'request.validation_failed': 'Certains champs sont invalides.',
  'request.timeout': 'Le serveur a mis trop de temps à répondre. Réessayez.',
  'resource.not_found': 'Cette ressource n’existe pas ou plus.',
  'resource.conflict': 'Cette action n’est plus possible.',
  'auth.unauthorized': 'Votre session a expiré. Reconnectez-vous.',
  'auth.forbidden': 'Vous n’avez pas accès à cette fonction.',
  'auth.invalid_credentials': 'Email ou mot de passe incorrect.',
  'auth.invalid_refresh_token': 'Votre session a expiré. Reconnectez-vous.',
  'auth.account_disabled': 'Ce compte est désactivé.',
  'auth.email_not_verified': 'Vérifiez votre email pour utiliser cette fonction.',
  'auth.invalid_code': 'Code incorrect ou expiré.',
  'auth.email_taken': 'Un compte existe déjà avec cet email. Connectez-vous ou réinitialisez le mot de passe.',
  'user.already_verified': 'Cet email est déjà vérifié.',
  'user.account_deleted': 'Ce compte a été supprimé.',
  'search.out_of_coverage': 'Cette position est hors de la zone couverte (Bénin).',
  'routing.no_route': 'Aucune route ne mène à cette station depuis votre position.',
  'routing.unavailable': 'Itinéraire indisponible pour le moment.',
  'report.too_far': 'Vous êtes à plus de 2 km de la station : ce signalement doit être fait sur place.',
  'report.duplicate': 'Vous avez déjà signalé ce problème il y a moins de 2 h.',
  'report.daily_limit': 'Vous avez atteint la limite de 10 signalements par jour.',
  'report.reporting_suspended': 'Votre droit de signaler a été suspendu.',
  'favorite.limit_reached': 'Vous avez déjà 20 favoris : retirez-en un pour en ajouter un autre.',
  'rate_limit.exceeded': 'Trop de demandes. Patientez un instant.',
  'service.unavailable': 'Le service est momentanément indisponible. Réessayez dans un instant.',
  'internal.error': 'Erreur inattendue du serveur.',
  'network.error': 'Connexion impossible. Vérifiez votre réseau.',
  'response.invalid': 'Réponse inattendue du serveur.',
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

export function errorMessage(code: string | undefined, status?: number, retryAfterS?: number): string {
  if (code === 'rate_limit.exceeded' || status === 429) {
    return retryAfterS && retryAfterS > 0
      ? `Trop de demandes. Réessayez dans ${retryAfterS < 60 ? `${retryAfterS} s` : `${Math.ceil(retryAfterS / 60)} min`}.`
      : byCode['rate_limit.exceeded']!
  }
  if (code && byCode[code]) return byCode[code]
  if (status && byStatus[status]) return byStatus[status]
  return byCode['internal.error']!
}
