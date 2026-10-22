import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../../', import.meta.url))

/**
 * Fin des tests : la base gostation_e2e est supprimée et la base Redis 15 vidée. E2E_KEEP=1 garde
 * la pile (développement des scénarios contre une pile déjà lancée). Staging : comptes de test et
 * données des fixtures supprimés du serveur, Mailpit vidé.
 */
export default function teardown() {
  if (process.env.E2E_KEEP === '1') return
  if (process.env.E2E_TARGET === 'staging') {
    const res = spawnSync('scripts/staging.sh', ['prod', 'e2e-cleanup'], {
      cwd: repo,
      encoding: 'utf8',
      timeout: 300_000,
    })
    if (res.status !== 0) console.error(`nettoyage du staging incomplet : ${res.stderr}`)
    else console.log(res.stdout.trim())
    return
  }
  const res = spawnSync('bash', ['scripts/e2e-stack.sh', 'down'], { cwd: repo, encoding: 'utf8', timeout: 120_000 })
  if (res.status !== 0) console.error(`e2e-stack.sh down a échoué : ${res.stderr}`)
}
