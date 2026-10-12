/**
 * Génère les styles de carte de l'app (src/map/styles/{light,dark}.json) depuis le style
 * OpenFreeMap « positron », recoloré aux tokens GoStation (neutres chauds, eau et parcs désaturés,
 * grands axes teintés d'orange) et allégé pour la data mobile :
 * - pas de sprite (écussons de routes retirés, pastilles des villes remplacées par le texte seul) ;
 * - pas de source raster (relief Natural Earth) ;
 * - noms en français quand ils existent ;
 * - tuiles vectorielles et polices OpenFreeMap inchangées (règle 6).
 *
 * Usage : npm run gen:map-styles (réseau requis ; le résultat est commité).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { tokens } from '../src/theme/tokens.cjs'

const SOURCE = 'https://tiles.openfreemap.org/styles/positron'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'map', 'styles')

type Layer = {
  id: string
  type: string
  source?: string
  paint?: Record<string, unknown>
  layout?: Record<string, unknown>
}

interface Palette {
  background: string
  residential: string
  park: string
  wood: string
  water: string
  waterway: string
  waterLabel: string
  building: string
  buildingOutline: string
  minor: string
  path: string
  majorCasing: string
  majorInner: string
  motorwayCasing: string
  motorwayInner: string
  rail: string
  railDash: string
  boundary: string
  label: string
  labelStrong: string
  roadLabel: string
  halo: string
}

const n = tokens.neutral
const b = tokens.brand

const palettes: Record<'light' | 'dark', Palette> = {
  light: {
    background: n[100],
    residential: '#efedea',
    park: '#e3e9dc',
    wood: '#dde4d6',
    water: '#c6d5dc',
    waterway: '#b7cad3',
    waterLabel: '#3f6476',
    building: '#e8e4e0',
    buildingOutline: n[300],
    minor: '#ffffff',
    path: '#ece9e6',
    majorCasing: n[300],
    majorInner: '#ffffff',
    motorwayCasing: b[200],
    motorwayInner: b[50],
    rail: n[300],
    railDash: n[50],
    boundary: n[400],
    label: n[700],
    labelStrong: n[900],
    roadLabel: n[500],
    halo: n[50],
  },
  dark: {
    background: '#100e0d',
    residential: '#151211',
    park: '#141a14',
    wood: '#131913',
    water: '#0d171c',
    waterway: '#142229',
    waterLabel: '#7fa2b3',
    building: '#1c1917',
    buildingOutline: '#252220',
    minor: '#2a2624',
    path: '#221f1d',
    majorCasing: '#1c1917',
    majorInner: '#3a3532',
    motorwayCasing: '#2a160c',
    motorwayInner: '#5a2c12',
    rail: '#3e3a37',
    railDash: '#151211',
    boundary: '#67625f',
    label: n[300],
    labelStrong: n[100],
    roadLabel: n[400],
    halo: n[950],
  },
}

/** Couleurs par couche (id OpenFreeMap → propriétés `paint` remplacées). */
function paints(p: Palette): Record<string, Record<string, unknown>> {
  const text = (color: string, halo = p.halo) => ({
    'text-color': color,
    'text-halo-color': halo,
    'text-halo-width': 1.2,
    'text-halo-blur': 0.5,
  })
  return {
    background: { 'background-color': p.background },
    park: { 'fill-color': p.park },
    water: { 'fill-color': p.water },
    landcover_ice_shelf: { 'fill-color': p.background },
    landcover_glacier: { 'fill-color': p.background },
    landuse_residential: { 'fill-color': p.residential },
    landcover_wood: { 'fill-color': p.wood },
    waterway: { 'line-color': p.waterway },
    building: { 'fill-color': p.building, 'fill-outline-color': p.buildingOutline },
    tunnel_motorway_casing: { 'line-color': p.motorwayCasing },
    tunnel_motorway_inner: { 'line-color': p.motorwayInner },
    'aeroway-taxiway': { 'line-color': p.path },
    'aeroway-runway-casing': { 'line-color': p.path },
    'aeroway-area': { 'fill-color': p.residential },
    'aeroway-runway': { 'line-color': p.minor },
    road_area_pier: { 'fill-color': p.background },
    road_pier: { 'line-color': p.background },
    highway_path: { 'line-color': p.path },
    highway_minor: { 'line-color': p.minor },
    highway_major_casing: { 'line-color': p.majorCasing },
    highway_major_inner: { 'line-color': p.majorInner },
    highway_major_subtle: { 'line-color': p.majorInner },
    highway_motorway_casing: { 'line-color': p.motorwayCasing },
    highway_motorway_inner: { 'line-color': p.motorwayInner },
    highway_motorway_subtle: { 'line-color': p.motorwayInner },
    highway_motorway_bridge_casing: { 'line-color': p.motorwayCasing },
    highway_motorway_bridge_inner: { 'line-color': p.motorwayInner },
    railway_transit: { 'line-color': p.rail },
    railway_transit_dashline: { 'line-color': p.railDash },
    railway_service: { 'line-color': p.rail },
    railway_service_dashline: { 'line-color': p.railDash },
    railway: { 'line-color': p.rail },
    railway_dashline: { 'line-color': p.railDash },
    boundary_3: { 'line-color': p.boundary },
    boundary_2: { 'line-color': p.boundary },
    boundary_disputed: { 'line-color': p.boundary },
    waterway_line_label: text(p.waterLabel),
    water_name_point_label: text(p.waterLabel),
    water_name_line_label: text(p.waterLabel),
    'highway-name-path': text(p.roadLabel),
    'highway-name-minor': text(p.roadLabel),
    'highway-name-major': text(p.roadLabel),
    airport: text(p.label),
    label_other: text(p.label),
    label_village: text(p.label),
    label_town: text(p.labelStrong),
    label_state: text(p.label),
    label_city: text(p.labelStrong),
    label_city_capital: text(p.labelStrong),
    label_country_3: text(p.labelStrong),
    label_country_2: text(p.labelStrong),
    label_country_1: text(p.labelStrong),
  }
}

/** Noms en français quand OpenStreetMap les a (« lac Nokoué »), sinon le nom local. */
const FRENCH_NAME = ['coalesce', ['get', 'name:fr'], ['get', 'name:latin'], ['get', 'name']]

/** Couches qui exigent le sprite (écussons) : retirées. */
const DROP = new Set(['highway-shield-non-us', 'highway-shield-us-interstate', 'road_shield_us'])

async function main() {
  const res = await fetch(SOURCE)
  if (!res.ok) throw new Error(`${SOURCE}: HTTP ${res.status}`)
  const base = (await res.json()) as { layers: Layer[]; sources: Record<string, unknown>; [k: string]: unknown }

  mkdirSync(OUT, { recursive: true })
  for (const scheme of ['light', 'dark'] as const) {
    const table = paints(palettes[scheme])
    const layers: Layer[] = []
    for (const layer of base.layers) {
      if (DROP.has(layer.id) || layer.source === 'ne2_shaded') continue
      const patch = table[layer.id]
      if (!patch) throw new Error(`couche sans couleur GoStation : ${layer.id} (style source modifié ?)`)
      const out: Layer = { ...layer, paint: { ...layer.paint, ...patch } }
      if (out.layout && 'text-field' in out.layout) out.layout = { ...out.layout, 'text-field': FRENCH_NAME }
      if (out.layout && 'icon-image' in out.layout) {
        const { 'icon-image': _icon, 'icon-size': _size, ...layout } = out.layout
        out.layout = layout
      }
      layers.push(out)
    }
    const { sprite: _sprite, sources, ...rest } = base
    const style = {
      ...rest,
      name: `GoStation ${scheme}`,
      sources: { openmaptiles: sources.openmaptiles },
      layers,
    }
    const file = join(OUT, `${scheme}.json`)
    writeFileSync(file, `${JSON.stringify(style)}\n`)
    console.log(`${file} : ${layers.length} couches`)
  }
}

await main()
