const fs = require('node:fs')
const path = require('node:path')

/**
 * Icônes lucide importées une par une : `import { Map } from 'lucide-react-native'` devient
 * `import Map from 'lucide-react-native/icons/map'`. Metro n'élague pas les ré-exports : sans cette
 * réécriture, les ~1 600 icônes de la bibliothèque finiraient dans le bundle (poids, démarrage).
 * La correspondance nom → fichier (alias compris : Trash2 → trash) est lue dans l'index du paquet.
 */
function lucideIconFiles() {
  // `main` du paquet (dist/cjs/…) : on remonte à la racine, package.json n'étant pas exporté.
  const root = path.resolve(path.dirname(require.resolve('lucide-react-native')), '..', '..')
  const index = path.join(root, 'dist/esm/lucide-react-native.mjs')
  const files = new Map()
  const re = /export \{([^}]+)\} from '\.\/icons\/([^']+)\.mjs'/g
  for (const [, names, file] of fs.readFileSync(index, 'utf8').matchAll(re)) {
    for (const part of names.split(',')) files.set(part.trim().replace(/^default as /, ''), file)
  }
  return files
}

function lucideImports({ types: t }) {
  let files
  return {
    visitor: {
      ImportDeclaration(p) {
        if (p.node.source.value !== 'lucide-react-native' || p.node.importKind === 'type') return
        files ??= lucideIconFiles()
        const kept = []
        const singles = []
        for (const s of p.node.specifiers) {
          const name = s.type === 'ImportSpecifier' ? (s.imported.name ?? s.imported.value) : null
          const file = name && s.importKind !== 'type' ? files.get(name) : undefined
          if (!file) {
            kept.push(s)
            continue
          }
          singles.push(
            t.importDeclaration(
              [t.importDefaultSpecifier(t.identifier(s.local.name))],
              t.stringLiteral(`lucide-react-native/icons/${file}`),
            ),
          )
        }
        if (singles.length === 0) return
        if (kept.length > 0) p.node.specifiers = kept
        p.replaceWithMultiple(kept.length > 0 ? [p.node, ...singles] : singles)
      },
    },
  }
}

module.exports = function (api) {
  const test = api.env('test')
  api.cache.using(() => test)
  return {
    // NativeWind : JSX compilé avec son runtime (className → styles natifs). Les worklets de
    // Reanimated 4 sont pris en charge par babel-preset-expo. Sous Jest, l'index lucide (CJS) suffit.
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: test ? [] : [lucideImports],
  }
}
