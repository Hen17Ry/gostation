const path = require('node:path')

const { getDefaultConfig } = require('expo/metro-config')
const { withNativeWind } = require('nativewind/metro')

const config = getDefaultConfig(__dirname)

// osrm-text-instructions charge les 31 langues ; l'app n'utilise que le français (règle 11).
const osrmLanguages = path.resolve(__dirname, 'src/features/navigation/osrm-languages-fr.js')
const resolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName === './languages' &&
    context.originModulePath.includes(`${path.sep}osrm-text-instructions${path.sep}`)
  ) {
    return { type: 'sourceFile', filePath: osrmLanguages }
  }
  return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform)
}

// 1 rem = 16 dp, comme sur le web : NativeWind compte 14 par défaut, ce qui réduisait toutes les
// tailles en rem de 12,5 % (boutons icône de 42 dp au lieu de 48, marges de 17,5 dp au lieu de 20).
module.exports = withNativeWind(config, { input: './src/global.css', inlineRem: 16 })
