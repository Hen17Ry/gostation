/**
 * 3D des scènes 3 à 7 (mode complet, chargée en arrière-plan pendant la scène 2) : le téléphone
 * et la Terre, chacun dans son calque en perspective de la scène unique.
 */
import { createGlobe } from './globe-model'
import { createPhone } from './phone-model'
import { getStage } from './stage'

export async function loadPhone(canvas: HTMLCanvasElement, onLost: () => void, screenCanvas: HTMLCanvasElement) {
  const stage = getStage(canvas, onLost)
  const layer = stage.addLayer('perspective', { key: 2.4, rim: 2.6, environment: 0.9 })
  const model = createPhone(screenCanvas)
  layer.scene.add(model.root)
  await stage.warmUp(layer)
  return { stage, layer, model }
}

export async function loadGlobe(canvas: HTMLCanvasElement, onLost: () => void) {
  const stage = getStage(canvas, onLost)
  const layer = stage.addLayer('perspective', { key: 0, rim: 0, environment: 0 })
  const globe = await createGlobe()
  layer.scene.add(globe.root)
  await stage.warmUp(layer)
  return { stage, layer, root: globe.root, globe }
}
