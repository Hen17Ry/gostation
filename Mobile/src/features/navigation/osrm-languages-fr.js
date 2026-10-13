// Remplace le module `languages` d'osrm-text-instructions (metro.config.js) : seul le français est
// embarqué (l'original charge 31 langues, ~750 Ko de bundle pour rien).
const fr = require('osrm-text-instructions/languages/translations/fr.json')
const grammarFr = require('osrm-text-instructions/languages/grammar/fr.json')
const abbreviationsFr = require('osrm-text-instructions/languages/abbreviations/fr.json')

module.exports = {
  supportedCodes: ['fr'],
  instructions: { fr },
  grammars: { fr: grammarFr },
  abbreviations: { fr: abbreviationsFr },
}
