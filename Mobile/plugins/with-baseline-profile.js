// Pose le profil de référence ART de l'app (plugins/baseline-prof.txt) dans le projet Android
// généré : AGP le fusionne avec ceux des bibliothèques dans l'APK (cf. docs/performance.md).
const fs = require('node:fs')
const path = require('node:path')

const { withDangerousMod } = require('expo/config-plugins')

module.exports = function withBaselineProfile(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const src = path.join(cfg.modRequest.projectRoot, 'plugins', 'baseline-prof.txt')
      const dest = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'baseline-prof.txt')
      await fs.promises.copyFile(src, dest)
      return cfg
    },
  ])
}
