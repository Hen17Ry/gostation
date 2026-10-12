import { describe, expect, it } from 'vitest'

import { errorMessage } from '@/i18n'

import { ApiError } from './errors'

describe('ApiError', () => {
  it('lit un problem+json : code stable, requestId, erreurs de champ, Retry-After', () => {
    const res = new Response(null, { status: 429, headers: { 'Retry-After': '42' } })
    const e = ApiError.fromResponse(res, {
      type: 'urn:gostation:problem:rate_limit.exceeded',
      title: 'Too Many Requests',
      status: 429,
      detail: 'Too many attempts, retry later.',
      code: 'rate_limit.exceeded',
      requestId: '01929b3e',
      errors: [{ field: 'email', code: 'invalid', message: 'bad' }],
      stationStatus: 'pending',
    })
    expect(e).toMatchObject({ status: 429, code: 'rate_limit.exceeded', requestId: '01929b3e', retryAfterS: 42 })
    expect(e.fields).toHaveLength(1)
    expect(e.extensions).toEqual({ stationStatus: 'pending' })
    expect(e.userMessage).toBe('Trop de tentatives. Réessayez dans 42 s.')
    expect(e.userMessage).not.toContain('Too many')
  })

  it('réessaie seulement les erreurs réseau et 5xx', () => {
    expect(ApiError.network(new TypeError('fetch failed')).isRetryable).toBe(true)
    expect(new ApiError({ status: 503, code: 'service.unavailable' }).isRetryable).toBe(true)
    expect(new ApiError({ status: 401, code: 'auth.unauthorized' }).isRetryable).toBe(false)
    expect(new ApiError({ status: 422, code: 'request.validation_failed' }).isRetryable).toBe(false)
  })
})

describe('messages en français', () => {
  it.each([
    ['auth.invalid_credentials', 401, 'Email ou mot de passe incorrect.'],
    ['auth.account_disabled', 403, 'Ce compte a été désactivé. Contactez un autre administrateur pour le réactiver.'],
    ['auth.invalid_second_factor', 401, 'Code incorrect. Vérifiez l’heure de votre téléphone puis réessayez.'],
    ['auth.invalid_mfa_token', 401, 'La vérification a expiré. Reconnectez-vous.'],
    ['code.inconnu', 404, 'Cette ressource n’existe pas ou plus.'],
    [undefined, 500, 'Erreur inattendue du serveur. L’équipe technique peut la retrouver avec la référence.'],
  ])('%s (%i)', (code, status, expected) => {
    expect(errorMessage(code, status)).toBe(expected)
  })

  it('attente en minutes au-delà d’une minute', () => {
    expect(errorMessage('rate_limit.exceeded', 429, 90)).toBe('Trop de tentatives. Réessayez dans 2 min.')
  })
})
