import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../../', import.meta.url))

export interface TestAdmin {
  email: string
  password: string
  firstName: string
  lastName: string
}

/**
 * Crée un admin avec la CLI (`cmd/admin create`), mot de passe sur stdin comme en CI : aucune
 * route publique ne crée d'admin. Email unique à chaque exécution.
 */
export function createAdmin(firstName = 'Awa', lastName = 'Houngbo'): TestAdmin {
  const email = `e2e.${Date.now().toString(36)}.${randomBytes(3).toString('hex')}@example.bj`
  const password = `Lagune-${randomBytes(6).toString('hex')}-Ouidah`
  const res = spawnSync(
    'scripts/with-env.sh',
    [
      'bash',
      '-c',
      'cd Backend && exec go run ./cmd/admin create --email "$0" --first-name "$1" --last-name "$2"',
      email,
      firstName,
      lastName,
    ],
    { cwd: repo, input: `${password}\n`, encoding: 'utf8', timeout: 120_000 },
  )
  if (res.status !== 0) throw new Error(`cmd/admin create a échoué (${res.status}) : ${res.stderr || res.error}`)
  return { email, password, firstName, lastName }
}
