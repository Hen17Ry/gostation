import type { Profile } from '@/api/schemas'

import { policyState } from './policy-gate'

const me = (accepted: string, current: string): Profile => ({
  id: 'u',
  email: 'afi@example.bj',
  firstName: 'Afi',
  lastName: 'Dossou',
  role: 'user',
  emailVerified: true,
  twoFactorEnabled: false,
  privacyPolicy: {
    acceptedVersion: accepted,
    acceptedAt: '2026-10-01T08:00:00Z',
    currentVersion: current,
    reacceptRequired: accepted !== current,
  },
  station: null,
  createdAt: '2026-10-01T08:00:00Z',
})

describe('policyState', () => {
  it('ne demande rien sans session ou quand la version courante est acceptée', () => {
    expect(policyState(undefined, '1.0')).toBe('ok')
    expect(policyState(me('1.0', '1.0'), '1.0')).toBe('ok')
  })

  it('demande la réacceptation d’une version 1.1 livrée avec l’app', () => {
    expect(policyState(me('1.0', '1.1'), '1.1')).toBe('accept')
  })

  it('demande la mise à jour de l’app quand elle ne contient pas la nouvelle version', () => {
    expect(policyState(me('1.0', '1.1'), '1.0')).toBe('outdated')
  })
})
