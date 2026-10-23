#!/usr/bin/env node
// Lighthouse sur le build servi par scripts/preview.mjs (mêmes en-têtes et CSP que Caddy) :
// 3 passes mobile et 3 ordinateur, médiane par score de performance. Rapports JSON dans
// ../var/lighthouse/. Usage : npm run preview (autre terminal), puis npm run lighthouse [url]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

const url = process.argv[2] || 'http://127.0.0.1:4322/'
const runs = Number(process.env.RUNS || 3)
const out = fileURLToPath(new URL('../../var/lighthouse/', import.meta.url))
mkdirSync(out, { recursive: true })

const results = {}
for (const preset of ['mobile', 'desktop']) {
  results[preset] = []
  for (let i = 1; i <= runs; i++) {
    const file = join(out, `${preset}-${i}.json`)
    execFileSync(
      'npx',
      [
        '--yes',
        'lighthouse@13.5.0',
        url,
        '--quiet',
        '--output=json',
        `--output-path=${file}`,
        '--only-categories=performance,accessibility,best-practices,seo',
        '--chrome-flags=--headless=new --no-sandbox',
        ...(preset === 'desktop' ? ['--preset=desktop'] : []),
      ],
      { stdio: 'inherit', env: { ...process.env, CHROME_PATH: chromium.executablePath() } },
    )
    const r = JSON.parse(readFileSync(file, 'utf8'))
    const a = r.audits
    results[preset].push({
      performance: Math.round(r.categories.performance.score * 100),
      accessibility: Math.round(r.categories.accessibility.score * 100),
      bestPractices: Math.round(r.categories['best-practices'].score * 100),
      seo: Math.round(r.categories.seo.score * 100),
      fcp: a['first-contentful-paint'].numericValue,
      lcp: a['largest-contentful-paint'].numericValue,
      tbt: a['total-blocking-time'].numericValue,
      cls: a['cumulative-layout-shift'].numericValue,
      benchmark: r.environment.benchmarkIndex,
    })
  }
}

const median = (list) => [...list].sort((a, b) => a.performance - b.performance)[Math.floor(list.length / 2)]
for (const [preset, list] of Object.entries(results)) {
  const m = median(list)
  console.log(
    `${preset.padEnd(8)} perf ${m.performance} · a11y ${m.accessibility} · bonnes pratiques ${m.bestPractices} · SEO ${m.seo} · ` +
      `FCP ${(m.fcp / 1000).toFixed(2)} s · LCP ${(m.lcp / 1000).toFixed(2)} s · TBT ${Math.round(m.tbt)} ms · CLS ${m.cls.toFixed(3)} ` +
      `(passes : ${list.map((r) => r.performance).join(', ')} ; indice CPU ${Math.round(m.benchmark)})`,
  )
}
