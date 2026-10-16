// Étape de build EAS (eas-build-pre-install, package.json : elle passe avant le prebuild) : copie
// la configuration Firebase de la variable d'environnement EAS de type fichier GOOGLE_SERVICES_JSON
// (chemin du fichier) vers Mobile/google-services.json, lu par app.config.ts. Build local
// (eas build --local) : EAS ne fournit pas la variable, elle se passe dans l'environnement du shell.
import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const source = process.env.GOOGLE_SERVICES_JSON
const target = join(import.meta.dirname, '..', 'google-services.json')
if (!source) {
  console.warn('GOOGLE_SERVICES_JSON absent : build sans Firebase (aucun push Android).')
} else if (!existsSync(target)) {
  copyFileSync(source, target)
  console.log('google-services.json copié depuis GOOGLE_SERVICES_JSON.')
}
