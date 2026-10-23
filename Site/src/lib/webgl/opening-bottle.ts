/**
 * Bouteille 3D de la scène d'ouverture (mode complet, chargée à la demande avec Three.js).
 */
import { createBottle, FULL_FILL, type BottleModel } from './bottle-model'
import { Stage } from './stage'

export type OpeningBottle = {
  stage: Stage
  model: BottleModel
  fullFill: number
}

let stage: Stage | null = null

/** Crée la scène WebGL unique (une seule fois) et la bouteille ; échoue si WebGL est absent. */
export async function loadOpeningBottle(canvas: HTMLCanvasElement, onLost: () => void): Promise<OpeningBottle> {
  stage ??= new Stage(canvas, onLost)
  const model = await createBottle()
  // Visible mais entièrement découpée (uFillY sous le sol) : les shaders se compilent dès maintenant.
  stage.scene.add(model.root)
  await stage.warmUp()
  return { stage, model, fullFill: FULL_FILL }
}
