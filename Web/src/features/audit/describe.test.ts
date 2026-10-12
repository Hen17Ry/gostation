import { describe, expect, it } from 'vitest'

import type { AuditEntry } from '@/api/admin-schemas'

import { actionLabel, actorName, auditChanges, auditDetails, auditSummary } from './describe'

const entry = (over: Partial<AuditEntry>): AuditEntry => ({
  id: '1',
  actor: { id: 'a', role: 'admin', firstName: 'Awa', lastName: 'Houngbo', email: 'awa@gostation.bj' },
  action: 'admin.station_corrected',
  entityType: 'station',
  entityId: 's1',
  metadata: {},
  requestId: null,
  createdAt: '2026-10-11T10:00:00Z',
  ...over,
})

describe('journal d’audit lisible', () => {
  it('libellé français de l’action, repli sur le code', () => {
    expect(actionLabel('admin.station_approved')).toBe('Station approuvée')
    expect(actionLabel('admin.inconnue')).toBe('admin.inconnue')
  })

  it('acteur : nom, sinon email, sinon Système', () => {
    expect(actorName(entry({}))).toBe('Awa Houngbo')
    expect(actorName(entry({ actor: { id: 'a', role: null, firstName: null, lastName: null, email: 'x@y.bj' } }))).toBe(
      'x@y.bj',
    )
    expect(actorName(entry({ actor: null }))).toBe('Système')
  })

  it('modifications champ par champ et transition de statut traduite', () => {
    const e = entry({
      metadata: {
        reason: 'Adresse complétée',
        changes: { address: { from: 'Rue A', to: 'Rue B' }, brand: { from: '', to: 'Oryx' } },
      },
    })
    expect(auditChanges(e)).toEqual([
      { field: 'address', label: 'Adresse', from: 'Rue A', to: 'Rue B' },
      { field: 'brand', label: 'Marque', from: '—', to: 'Oryx' },
    ])
    expect(auditSummary(e)).toBe('Adresse : Rue A → Rue B · Marque : — → Oryx — Motif : Adresse complétée')

    const status = entry({
      action: 'admin.station_rejected',
      metadata: { from: 'pending', to: 'rejected', reason: 'Illisible' },
    })
    expect(auditChanges(status)).toEqual([{ field: 'status', label: 'Statut', from: 'En attente', to: 'Refusée' }])
  })

  it('détails : clés techniques masquées, distances lisibles', () => {
    const e = entry({
      action: 'auth.login_succeeded',
      entityType: 'user',
      metadata: { client: 'web', sessionId: 'secret-ish', moveMeters: 1200 },
    })
    expect(auditDetails(e)).toEqual([
      { key: 'client', label: 'Client', value: 'web' },
      { key: 'moveMeters', label: 'Déplacement', value: '1,2 km' },
    ])
  })
})
