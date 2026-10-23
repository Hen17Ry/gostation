/**
 * Bouteille 3D de la scène d'ouverture (mode complet, chargée à la demande avec Three.js).
 */
import { createBottle, FULL_FILL, type BottleModel } from './bottle-model'
import { getStage, type Layer, type Stage } from './stage'

export type OpeningBottle = {
  stage: Stage
  layer: Layer
  model: BottleModel
  fullFill: number
}

/** Crée la bouteille dans son calque orthographique ; échoue si WebGL est absent. */
export async function loadOpeningBottle(canvas: HTMLCanvasElement, onLost: () => void): Promise<OpeningBottle> {
  const stage = getStage(canvas, onLost)
  const layer = stage.addLayer('ortho', { key: 2.6, rim: 2.2, environment: 0.5 })
  const model = await createBottle()
  // Visible mais entièrement découpée (uFillY sous le sol) : les shaders se compilent dès maintenant.
  layer.scene.add(model.root)
  stage.show(layer, true)
  await stage.warmUp(layer)
  return { stage, layer, model, fullFill: FULL_FILL }
}
