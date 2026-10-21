import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../../', import.meta.url))

function staging(args: string[]): string {
  const res = spawnSync('scripts/staging.sh', ['prod', ...args], { cwd: repo, encoding: 'utf8', timeout: 300_000 })
  if (res.status !== 0) throw new Error(`scripts/staging.sh prod ${args.join(' ')} a échoué : ${res.stderr}`)
  return res.stdout
}

/**
 * E2E contre le staging : restes d'un lancement interrompu supprimés, puis fixtures créées sur le
 * serveur (e2efixtures, par SSH) et écrites là où les scénarios les lisent (var/e2e/fixtures.json).
 */
export default function stagingSetup() {
  staging(['e2e-cleanup'])
  const json = staging(['e2e-fixtures'])
  JSON.parse(json) // sortie invalide : échec immédiat plutôt qu'au premier scénario
  mkdirSync(`${repo}var/e2e`, { recursive: true })
  writeFileSync(`${repo}var/e2e/fixtures.json`, json, { mode: 0o600 })
}
