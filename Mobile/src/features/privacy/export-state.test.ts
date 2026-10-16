import type { DataExport } from '@/api/schemas'

import { exportStep } from './export-state'

const base: DataExport = { status: 'none', createdAt: null, expiresAt: null, sizeBytes: null, downloadUrl: null }

describe('exportStep', () => {
  it('propose de préparer une copie quand il n’y en a pas', () => {
    expect(exportStep(undefined)).toBe('prepare')
    expect(exportStep(base)).toBe('prepare')
  })

  it('suit la génération, puis le partage', () => {
    expect(exportStep({ ...base, status: 'pending', createdAt: '2026-10-16T10:00:00Z' })).toBe('preparing')
    expect(
      exportStep({ ...base, status: 'ready', downloadUrl: '/api/v1/me/data-export/x/download?expires=1&signature=s' }),
    ).toBe('share')
  })

  it('propose une nouvelle copie après un échec ou une expiration', () => {
    expect(exportStep({ ...base, status: 'failed' })).toBe('again')
    expect(exportStep({ ...base, status: 'expired' })).toBe('again')
    expect(exportStep({ ...base, status: 'ready' })).toBe('again')
  })
})
