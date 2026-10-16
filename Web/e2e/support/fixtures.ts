import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../../', import.meta.url))

export interface StationFixture {
  id: string
  name: string
  ifu: string
  managerEmail: string
}

/** Données des scénarios, créées par Backend/cmd/e2efixtures au lancement de la pile. */
export interface Fixtures {
  run: string
  pendingApprove: StationFixture
  pendingReject: StationFixture
  move: StationFixture
  correct: StationFixture
  reported: StationFixture
  reportId: string
  excluded: StationFixture
  user: { id: string; email: string; name: string }
  product: { id: number; label: string; stations: number }
  dataRequest: RequestFixture
  lateRequest: RequestFixture
}

export interface RequestFixture {
  id: string
  reference: string
  email: string
}

export const fixtures = (): Fixtures => JSON.parse(readFileSync(`${repo}var/e2e/fixtures.json`, 'utf8')) as Fixtures
