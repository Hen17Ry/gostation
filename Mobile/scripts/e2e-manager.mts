/**
 * Actions d'un gérant de démo sur la pile E2E (API 127.0.0.1:8095), pour mettre l'app dans un état
 * donné pendant les tests : stock d'un produit, fermeture exceptionnelle du jour. Passe par l'API
 * (If-Match, invalidation du cache de recherche, alertes « de retour en stock » envoyées par le worker).
 *
 *   node scripts/e2e-manager.mts stock <email> <motDePasse> <code produit> <quantité>
 *   node scripts/e2e-manager.mts close-today <email> <motDePasse>
 */
const API = process.env.E2E_API ?? 'http://127.0.0.1:8095'
const [cmd, email, password, ...rest] = process.argv.slice(2)

async function call(path: string, init: RequestInit & { token?: string; etag?: string } = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Install-Id': '00000000-0000-4000-8000-0000000000e2',
  }
  if (init.token) headers.Authorization = `Bearer ${init.token}`
  if (init.etag) headers['If-Match'] = init.etag
  const res = await fetch(`${API}${path}`, { ...init, headers })
  const body = res.status === 204 ? null : await res.json()
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${JSON.stringify(body)}`)
  return { body, etag: res.headers.get('ETag') ?? undefined }
}

const { body: session } = await call('/api/v1/auth/login', {
  method: 'POST',
  body: JSON.stringify({ email, password }),
})
const token = (session as { accessToken: string }).accessToken

if (cmd === 'stock') {
  const [code, qty] = rest
  const quantity = Number(qty)
  const { body: catalog } = await call('/api/v1/products')
  const productId = (catalog as { items: { id: number; code: string }[] }).items.find((p) => p.code === code)?.id
  if (productId === undefined) throw new Error(`produit inconnu : ${code}`)
  const { body, etag } = await call('/api/v1/manager/station/stocks', { token })
  const items = (body as { items: { productId: number; quantity: number }[] }).items.map((i) => ({
    productId: i.productId,
    quantity: i.productId === productId ? quantity : i.quantity,
  }))
  if (!items.some((i) => i.productId === productId)) throw new Error(`produit ${productId} non vendu par cette station`)
  await call('/api/v1/manager/station/stocks', { method: 'PUT', token, etag, body: JSON.stringify({ items }) })
  console.log(`stock ${code} = ${quantity}`)
} else if (cmd === 'close-today') {
  const { etag } = await call('/api/v1/manager/station', { token })
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Porto-Novo' }).format(new Date())
  await call('/api/v1/manager/station/closures', {
    method: 'POST',
    token,
    etag,
    body: JSON.stringify({ date: today, reason: 'Inventaire' }),
  })
  console.log(`fermée le ${today}`)
} else {
  throw new Error(`commande inconnue : ${cmd}`)
}
