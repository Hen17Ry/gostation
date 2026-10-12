// Lit le code à 6 chiffres envoyé à EMAIL dans Mailpit (API locale, http://127.0.0.1:8025).
// L'email part par le worker, de façon asynchrone : on réessaie pendant une dizaine de secondes.
let base = 'http://127.0.0.1:8025/api/v1'
let code = null
let deadline = Date.now() + 10000
while (code === null && Date.now() < deadline) {
  let list = json(http.get(base + '/search?query=' + encodeURIComponent('to:"' + EMAIL + '"')).body)
  if (list.messages && list.messages.length > 0) {
    let msg = json(http.get(base + '/message/' + list.messages[0].ID).body)
    let m = /\b(\d{6})\b/.exec(msg.Text || '')
    if (m) code = m[1]
  }
  if (code === null) {
    let until = Date.now() + 400
    while (Date.now() < until) {
      // attente active : pas de minuterie dans le moteur JS de Maestro
    }
  }
}
if (code === null) throw new Error('code introuvable pour ' + EMAIL)
output.code = code
