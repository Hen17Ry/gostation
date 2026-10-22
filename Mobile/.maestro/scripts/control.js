// Pilotage des scénarios gérant (e2efixtures serve, 127.0.0.1:8097 : pile E2E ; staging : CONTROL_URL,
// le pilotage du serveur par le tunnel SSH).
// ACTION : approve, reject, suspend, operational, bump-stocks ; EMAIL et REASON selon l'action.
// operational renvoie le gérant d'une station prête (output.email, output.password).
const body = { email: typeof EMAIL !== 'undefined' ? EMAIL : '' }
if (typeof REASON !== 'undefined' && REASON) body.reason = REASON
const control = typeof CONTROL_URL !== 'undefined' && CONTROL_URL ? CONTROL_URL : 'http://127.0.0.1:8097'
const res = http.post(control + '/managers/' + ACTION, {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
if (res.status !== 200) throw new Error(ACTION + ' : HTTP ' + res.status + ' ' + res.body)
const out = json(res.body)
if (out.email) {
  output.email = out.email
  output.password = out.password
  output.stationName = out.name
}
