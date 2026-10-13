import { errorMessage } from '@/i18n'

export interface FieldError {
  field: string
  code: string
  message: string
}

/**
 * Erreur typée issue d'une réponse problem+json (RFC 9457) ou d'un échec réseau. Le message
 * affichable vient du `code` stable, jamais de `title`/`detail` (en anglais).
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId?: string
  readonly fields: FieldError[]
  readonly retryAfterS?: number

  constructor(init: {
    status: number
    code: string
    requestId?: string
    fields?: FieldError[]
    retryAfterS?: number
    cause?: unknown
  }) {
    super(`${init.status} ${init.code}`, { cause: init.cause })
    this.name = 'ApiError'
    this.status = init.status
    this.code = init.code
    this.requestId = init.requestId
    this.fields = init.fields ?? []
    this.retryAfterS = init.retryAfterS
  }

  get userMessage(): string {
    return errorMessage(this.code, this.status, this.retryAfterS)
  }

  get isNetwork(): boolean {
    return this.code === 'network.error'
  }

  /** Nouvel essai automatique seulement sur erreur réseau ou 5xx (CLAUDE.md). */
  get isRetryable(): boolean {
    return this.isNetwork || this.status >= 500
  }

  static fromResponse(response: Response, body: unknown): ApiError {
    const p = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
    const retry = Number(response.headers.get('Retry-After'))
    return new ApiError({
      status: response.status,
      code: typeof p.code === 'string' ? p.code : `http.${response.status}`,
      requestId: typeof p.requestId === 'string' ? p.requestId : (response.headers.get('X-Request-ID') ?? undefined),
      fields: Array.isArray(p.errors) ? (p.errors as FieldError[]) : [],
      retryAfterS: Number.isFinite(retry) && retry > 0 ? retry : undefined,
    })
  }

  static network(cause: unknown): ApiError {
    return new ApiError({ status: 0, code: 'network.error', cause })
  }

  static invalidResponse(cause: unknown): ApiError {
    return new ApiError({ status: 0, code: 'response.invalid', cause })
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError
