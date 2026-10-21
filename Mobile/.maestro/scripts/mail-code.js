// Lit le code à 6 chiffres envoyé à EMAIL dans Mailpit (API locale, http://127.0.0.1:8025 ; staging :
// MAILPIT_URL, le Mailpit du serveur par le tunnel SSH).
// SUBJECT (facultatif) filtre sur l'objet : « Confirmez » (vérification, par défaut) ou
// « Réinitialisation » (mot de passe oublié), pour ne jamais relire un ancien code.
// L'email part par le worker, de façon asynchrone : on réessaie pendant une quinzaine de secondes.
const base = (typeof MAILPIT_URL !== 'undefined' && MAILPIT_URL ? MAILPIT_URL : 'http://127.0.0.1:8025') + '/api/v1'
const subject = typeof SUBJECT !== 'undefined' && SUBJECT ? SUBJECT : 'Confirmez'
const query = 'to:"' + EMAIL + '" subject:"' + subject + '"'
let code = null
const deadline = Date.now() + 15000
while (code === null && Date.now() < deadline) {
  const list = json(http.get(base + '/search?query=' + encodeURIComponent(query)).body)
  if (list.messages && list.messages.length > 0) {
    const msg = json(http.get(base + '/message/' + list.messages[0].ID).body)
    const m = /\b(\d{6})\b/.exec(msg.Text || '')
    if (m) code = m[1]
  }
  if (code === null) {
    const until = Date.now() + 400
    while (Date.now() < until) {
      // attente active : pas de minuterie dans le moteur JS de Maestro
    }
  }
}
if (code === null) throw new Error('code introuvable pour ' + EMAIL + ' (' + subject + ')')
output.code = code
