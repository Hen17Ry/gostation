import { requestSchema } from './request-form'

describe('requestSchema', () => {
  it('exige des précisions pour une rectification ou une autre demande', () => {
    expect(requestSchema.safeParse({ type: 'rectification', details: 'court' }).success).toBe(false)
    expect(requestSchema.safeParse({ type: 'other', details: '   ' }).success).toBe(false)
    expect(requestSchema.safeParse({ type: 'rectification', details: 'Mon nom est mal écrit.' }).success).toBe(true)
  })

  it('laisse les précisions facultatives pour les autres types', () => {
    for (const type of ['access', 'opposition', 'deletion'] as const) {
      expect(requestSchema.safeParse({ type, details: '' }).success).toBe(true)
    }
  })

  it('refuse plus de 2 000 caractères et les types inconnus', () => {
    expect(requestSchema.safeParse({ type: 'access', details: 'x'.repeat(2001) }).success).toBe(false)
    expect(requestSchema.safeParse({ type: 'export', details: '' }).success).toBe(false)
  })
})
