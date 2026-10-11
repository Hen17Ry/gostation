// Bench k6 de GET /api/v1/search (make bench). Positions tirées autour de cinq zones : quatre
// villes et une zone rurale. Mesure, depuis l'en-tête Server-Timing :
//   - server_ms : temps serveur hors OSRM (total - osrm), séparé selon X-Cache (hit / miss) ;
//   - osrm_ms   : temps OSRM /table, mesuré à part ;
//   - cache_hit : taux de réponses dont les candidats venaient du cache.
// Cibles (CLAUDE.md, étape 5) : p95 < 150 ms hors cache, < 30 ms avec cache, hors OSRM.
// Un échauffement de 10 s (connexions du pool, chargement de PostGIS par connexion, plans) précède
// la mesure ; il est exclu des statistiques (sous-métriques {scenario:search}).
import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL || 'http://127.0.0.1:18080';
const PRODUCTS = (__ENV.PRODUCT_IDS || '1,2,3,4,5').split(',').map(Number);
const RATE = Number(__ENV.RATE || 100);
const DURATION = __ENV.DURATION || '60s';

// sigmaKm : dispersion des recherches autour du centre (les recherches se concentrent en ville).
const ZONES = [
  { name: 'cotonou', lat: 6.3703, lng: 2.3912, sigmaKm: 3 },
  { name: 'porto-novo', lat: 6.4969, lng: 2.6036, sigmaKm: 2 },
  { name: 'parakou', lat: 9.337, lng: 2.6303, sigmaKm: 2.5 },
  { name: 'natitingou', lat: 10.3042, lng: 1.3796, sigmaKm: 2 },
  { name: 'rurale', lat: 10.85, lng: 2.15, sigmaKm: 8 }, // entre Kérou et Banikoara
];

const serverMs = new Trend('server_ms', true);
const osrmMs = new Trend('osrm_ms', true);
const dbMs = new Trend('db_ms', true);
const cacheHit = new Rate('cache_hit');
const approximate = new Rate('routing_approximate');

const S = 'scenario:search';
const thresholds = {
  [`server_ms{cache:miss,${S}}`]: ['p(95)<150'],
  [`server_ms{cache:hit,${S}}`]: ['p(95)<30'],
  [`checks{${S}}`]: ['rate>0.99'],
};
// Sous-métriques mesurées (seuil toujours vrai : il sert à les faire apparaître dans le résumé).
for (const m of ['http_req_duration', 'osrm_ms', 'db_ms']) thresholds[`${m}{${S}}`] = ['p(95)>=0'];
for (const m of ['cache_hit', 'routing_approximate', 'http_reqs']) thresholds[`${m}{${S}}`] = m === 'http_reqs' ? ['count>=0'] : ['rate>=0'];
for (const z of ZONES) {
  thresholds[`http_req_duration{zone:${z.name},${S}}`] = ['p(95)>=0'];
  thresholds[`cache_hit{zone:${z.name},${S}}`] = ['rate>=0'];
}

export const options = {
  discardResponseBodies: false,
  summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    warmup: { executor: 'constant-arrival-rate', rate: 20, timeUnit: '1s', duration: '10s', preAllocatedVUs: 10, maxVUs: 50 },
    search: {
      executor: 'constant-arrival-rate',
      startTime: '10s',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 50,
      maxVUs: 300,
    },
  },
  thresholds,
};

function uuid4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
const installId = uuid4(); // une installation par VU

function gauss() {
  let u = 0;
  while (u === 0) u = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}

function timing(header, name) {
  const m = new RegExp(`${name};dur=([0-9.]+)`).exec(header || '');
  return m ? Number(m[1]) : NaN;
}

export default function () {
  const z = ZONES[Math.floor(Math.random() * ZONES.length)];
  const lat = z.lat + (gauss() * z.sigmaKm) / 111.32;
  const lng = z.lng + (gauss() * z.sigmaKm) / (111.32 * Math.cos((z.lat * Math.PI) / 180));
  const product = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
  const url = `${BASE}/api/v1/search?lat=${lat.toFixed(5)}&lng=${lng.toFixed(5)}&product_id=${product}`;
  const res = http.get(url, { headers: { 'X-Install-Id': installId }, tags: { zone: z.name, name: 'search' } });
  const ok = check(res, { 'status 200': (r) => r.status === 200 });
  if (!ok) return;
  const st = res.headers['Server-Timing'];
  const hit = res.headers['X-Cache'] === 'HIT';
  const total = timing(st, 'total');
  const osrm = timing(st, 'osrm');
  const tags = { cache: hit ? 'hit' : 'miss', zone: z.name };
  serverMs.add(total - osrm, tags);
  if (osrm > 0) osrmMs.add(osrm, { zone: z.name });
  dbMs.add(timing(st, 'db'), tags);
  cacheHit.add(hit, { zone: z.name });
  approximate.add(res.json('routingApproximate') === true, { zone: z.name });
}

function fmt(v) {
  return v === undefined || Number.isNaN(v) ? '   –  ' : v.toFixed(1).padStart(6);
}

function row(label, m) {
  if (!m) return `  ${label.padEnd(26)}   (aucune mesure)`;
  const v = m.values;
  return `  ${label.padEnd(26)} p50 ${fmt(v['p(50)'])}  p95 ${fmt(v['p(95)'])}  p99 ${fmt(v['p(99)'])}  max ${fmt(v.max)}  (ms)`;
}

function pct(m) {
  return m ? `${(m.values.rate * 100).toFixed(1)} %` : '–';
}

export function handleSummary(data) {
  const M = data.metrics;
  const g = (name) => M[`${name}{${S}}`];
  const lines = [];
  const reqs = g('http_reqs') ? g('http_reqs').values.count : 0;
  lines.push('', `GoStation — bench /api/v1/search : ${reqs} requêtes mesurées, ${RATE} req/s pendant ${DURATION} (après 10 s d'échauffement)`, '');
  lines.push(row('HTTP (client, OSRM inclus)', g('http_req_duration')));
  lines.push(row('Serveur hors OSRM — miss', M[`server_ms{cache:miss,${S}}`]));
  lines.push(row('Serveur hors OSRM — hit', M[`server_ms{cache:hit,${S}}`]));
  lines.push(row('OSRM /table (à part)', g('osrm_ms')));
  lines.push(row('Base de données', g('db_ms')));
  lines.push('', `  Taux de cache : ${pct(g('cache_hit'))}   Succès HTTP : ${pct(g('checks'))}   Routage approximatif : ${pct(g('routing_approximate'))}`, '');
  lines.push('  Par zone (HTTP, OSRM inclus) :');
  for (const z of ZONES) {
    lines.push(`${row(z.name, M[`http_req_duration{zone:${z.name},${S}}`])}   cache ${pct(M[`cache_hit{zone:${z.name},${S}}`])}`);
  }
  lines.push('', '  Seuils :');
  for (const [name, m] of Object.entries(M)) {
    if (!m.thresholds || name.includes('zone:') || Object.keys(m.thresholds).some((e) => e.includes('>=0'))) continue;
    for (const [expr, t] of Object.entries(m.thresholds)) {
      lines.push(`    ${t.ok ? '✔' : '✖'} ${name} ${expr}`);
    }
  }
  lines.push('');
  const out = { stdout: lines.join('\n') };
  if (__ENV.RESULTS) out[__ENV.RESULTS] = JSON.stringify(data, null, 2);
  return out;
}
