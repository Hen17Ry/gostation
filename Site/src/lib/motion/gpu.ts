/**
 * Un vrai processeur graphique ? Sans lui (SwiftShader, llvmpipe : rendu logiciel), la 3D bloque le
 * fil principal (compilation des shaders, chaque image) : le site passe en mode léger avant même de
 * télécharger Three.js. failIfMajorPerformanceCaveat refuse le contexte dans ce cas ; le nom du
 * moteur de rendu sert de second avis.
 */
export function hasHardwareGpu(): boolean {
  try {
    const canvas = document.createElement('canvas')
    const options = { failIfMajorPerformanceCaveat: true }
    const gl = (canvas.getContext('webgl2', options) ??
      canvas.getContext('webgl', options)) as WebGLRenderingContext | null
    if (!gl) return false
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    return !/swiftshader|llvmpipe|softpipe|software/i.test(renderer)
  } catch {
    return false
  }
}
