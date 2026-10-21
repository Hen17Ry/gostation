import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../../', import.meta.url))

export interface TestAdmin {
  email: string
  password: string
  firstName: string
  lastName: string
}

/** Variables de la pile E2E (base gostation_e2e, Redis 15), écrites par scripts/e2e-stack.sh. */
function e2eEnv(): Record<string, string> {
  return JSON.parse(readFileSync(`${repo}var/e2e/env.json`, 'utf8')) as Record<string, string>
}

/**
 * Crée un admin sur la base E2E avec la CLI (`cmd/admin create`, binaire compilé par la pile),
 * mot de passe sur stdin : aucune route publique ne crée d'admin. Email unique à chaque appel.
 */
export function createAdmin(firstName = 'Awa', lastName = 'Houngbo'): TestAdmin {
  const email = `e2e.${Date.now().toString(36)}.${randomBytes(3).toString('hex')}@example.bj`
  const password = `Lagune-${randomBytes(6).toString('hex')}-Ouidah`
  if (process.env.E2E_TARGET === 'staging') {
    // Staging : la CLI tourne sur le serveur (scripts/prod.sh admin-create, par SSH).
    const res = spawnSync('scripts/staging.sh', ['prod', 'admin-create', email, firstName, lastName], {
      cwd: repo,
      input: `${password}\n`,
      encoding: 'utf8',
      timeout: 120_000,
    })
    if (res.status !== 0) throw new Error(`admin-create sur le staging a échoué (${res.status}) : ${res.stderr}`)
    return { email, password, firstName, lastName }
  }
  const res = spawnSync(
    'scripts/with-env.sh',
    ['var/e2e/bin/admin', 'create', '--email', email, '--first-name', firstName, '--last-name', lastName],
    { cwd: repo, input: `${password}\n`, encoding: 'utf8', timeout: 60_000, env: { ...process.env, ...e2eEnv() } },
  )
  if (res.status !== 0) throw new Error(`cmd/admin create a échoué (${res.status}) : ${res.stderr || res.error}`)
  return { email, password, firstName, lastName }
}
