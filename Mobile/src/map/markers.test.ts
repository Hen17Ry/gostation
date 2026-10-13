import { createExpression, type ExpressionSpecification } from '@maplibre/maplibre-gl-style-spec'

import { clusterProperties, markerKey, markerOpen, markerRank } from './markers'

function evaluate(expr: ExpressionSpecification, properties: Record<string, unknown>) {
  const compiled = createExpression(expr, 'layers[0].paint.test')
  if (compiled.result !== 'success') throw new Error(JSON.stringify(compiled.value))
  return compiled.value.evaluate({ zoom: 12 }, { type: 1, properties } as never)
}

// Regroupement natif simulé : MapLibre réduit `key` avec l'opérateur de clusterProperties (min).
function clusterOf(points: { rank: number; open: boolean }[]) {
  expect(clusterProperties.best[0]).toBe('min')
  return {
    cluster: true,
    point_count: points.length,
    best: Math.min(...points.map((p) => markerKey(p.rank, p.open))),
  }
}

describe('marqueurs', () => {
  it('une station montre son rang et son état', () => {
    const props = { rank: 3, open: 0, key: markerKey(3, false) }
    expect(evaluate(markerRank, props)).toBe('3')
    expect(evaluate(markerOpen, props)).toBe(false)
  })

  // Régression : le groupe des stations 2 et 4 affichait « 2 » (nombre de stations), lu comme le
  // rang 2. Il affiche maintenant le meilleur rang qu'il contient.
  it('un groupe montre le meilleur rang qu’il contient, pas son nombre de stations', () => {
    const props = clusterOf([
      { rank: 4, open: true },
      { rank: 7, open: true },
      { rank: 5, open: true },
    ])
    expect(evaluate(markerRank, props)).toBe('4')
    expect(evaluate(markerRank, props)).not.toBe(String(props.point_count))
  })

  it('un groupe prend l’état de sa meilleure station', () => {
    const closedFirst = clusterOf([
      { rank: 1, open: false },
      { rank: 2, open: true },
    ])
    expect(evaluate(markerRank, closedFirst)).toBe('1')
    expect(evaluate(markerOpen, closedFirst)).toBe(false)
    const openFirst = clusterOf([
      { rank: 6, open: false },
      { rank: 3, open: true },
    ])
    expect(evaluate(markerRank, openFirst)).toBe('3')
    expect(evaluate(markerOpen, openFirst)).toBe(true)
  })
})
