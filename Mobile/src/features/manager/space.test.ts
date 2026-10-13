import { holdStep } from '@/components/ui/stepper'

import { SPACE_HOME, spaceOf } from './space'

describe('espace de l’app selon le compte (D58)', () => {
  it('gérant approuvé → stocks ; en attente, rejeté, suspendu → statut ; sinon utilisateur', () => {
    expect(spaceOf({ role: 'manager', stationStatus: 'approved' })).toBe('manager')
    for (const s of ['pending', 'rejected', 'suspended'] as const) {
      expect(spaceOf({ role: 'manager', stationStatus: s })).toBe('manager-status')
    }
    expect(spaceOf({ role: 'manager', stationStatus: null })).toBe('manager-status')
    expect(spaceOf({ role: 'user', stationStatus: null })).toBe('user')
    expect(spaceOf(null)).toBe('user')
    expect(SPACE_HOME).toEqual({ user: '/', manager: '/manager/stocks', 'manager-status': '/manager/status' })
  })
})

describe('appui long du compteur', () => {
  it('accélère : 1, puis 5, puis 10 par pas', () => {
    expect([0, 9, 10, 24, 25, 60].map(holdStep)).toEqual([1, 1, 5, 5, 10, 10])
  })
})
