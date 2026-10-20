/*
 * lucide-react-native pour Jest, chargé à la demande. Le bundle CommonJS du paquet fait un
 * `require` par icône (près de 1 900) : environ 2 s dans le registre de modules de Jest, payées par
 * chaque fichier de test qui affiche une icône, ce qui suffisait à dépasser le délai des tests
 * quand plusieurs suites tournent en même temps. Ce module lit la table d'exports du bundle et ne
 * charge que les icônes réellement utilisées : les composants rendus sont les vrais.
 * Branché par `moduleNameMapper` (package.json).
 */
/* global __dirname */
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

// Chemin direct : le champ `exports` du paquet n'ouvre pas dist/cjs, et `lucide-react-native` est
// lui-même redirigé ici.
const dir = join(__dirname, '../../node_modules/lucide-react-native/dist/cjs')
const bundle = join(dir, 'lucide-react-native.js')
const source = readFileSync(bundle, 'utf8')

// var chevronRight = require('./icons/chevron-right.js');
const files = new Map()
for (const [, local, file] of source.matchAll(/^var (\w+) = require\('(\.[^']+)'\);$/gm)) files.set(local, file)
// exports.ChevronRight = chevronRight.default;  exports.Icon = Icon;
const exportsTable = new Map()
for (const [, name, local, member] of source.matchAll(/^exports\.(\w+) = (\w+)(?:\.(\w+))?;$/gm)) {
  if (files.has(local)) exportsTable.set(name, { file: files.get(local), member })
}

const loaded = new Map()
function load(name) {
  if (!loaded.has(name)) {
    const entry = exportsTable.get(name)
    const mod = require(join(dir, entry.file))
    loaded.set(name, entry.member ? mod[entry.member] : mod)
  }
  return loaded.get(name)
}

module.exports = new Proxy(
  {},
  {
    get(_, name) {
      if (name === '__esModule') return true
      return typeof name === 'string' && exportsTable.has(name) ? load(name) : undefined
    },
    has: (_, name) => name === '__esModule' || exportsTable.has(name),
    ownKeys: () => ['__esModule', ...exportsTable.keys()],
    getOwnPropertyDescriptor: (_, name) =>
      name === '__esModule' || exportsTable.has(name)
        ? { configurable: true, enumerable: true, get: () => (name === '__esModule' ? true : load(name)) }
        : undefined,
  },
)
