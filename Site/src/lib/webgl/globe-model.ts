/**
 * La Terre de nuit (scène 7, mode complet) : sphère dont la texture équirectangulaire
 * (public/textures/earth.png, scripts/gen-geo.py) porte les terres en points (rouge) et le Bénin
 * (vert) ; atmosphère en lumière de contour. Tournée pour que le Bénin soit face à la caméra.
 * Rayon du modèle : 1 ; la scène le met à l'échelle du disque de l'illustration 2D.
 */
import {
  AdditiveBlending,
  BackSide,
  Color,
  Group,
  Mesh,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  type Texture,
} from 'three'

import { palette } from '../tokens.generated'

const BENIN = { lon: 2.3, lat: 9.3 }

const vertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vView = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`

const surface = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 ocean;
  uniform vec3 land;
  uniform vec3 benin;
  uniform vec3 rim;
  uniform float glow;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 t = texture2D(map, vUv);
    vec3 col = mix(ocean, land, t.r * 0.85);
    col = mix(col, benin * (1.0 + glow * 0.6), t.g);
    float facing = max(dot(vNormal, vView), 0.0);
    col *= 0.35 + 0.65 * smoothstep(0.0, 0.6, facing);
    col += rim * pow(1.0 - facing, 3.0) * 0.3;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

const atmosphere = /* glsl */ `
  uniform vec3 rim;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    // Coque vue de l'intérieur : x = 0 au centre, x ≈ 0,64 au bord de la Terre, x = 1 au bord de la
    // coque. Lueur maximale au ras de la Terre, nulle au bord de la coque (aucun contour dur).
    float x = 1.0 + dot(vNormal, vView);
    float i = pow(clamp((1.0 - x) / 0.36, 0.0, 1.0), 2.2);
    gl_FragColor = vec4(rim * i * 0.85, 1.0);
    #include <colorspace_fragment>
  }
`

export type GlobeModel = { root: Group; spin: Group; setGlow: (v: number) => void; dispose: () => void }

export async function createGlobe(): Promise<GlobeModel> {
  const map: Texture = await new TextureLoader().loadAsync('/textures/earth.png')
  map.anisotropy = 8
  const color = (hex: string) => new Color(hex)
  const material = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: surface,
    uniforms: {
      map: { value: map },
      ocean: { value: color(palette.neutral[900]) },
      land: { value: color(palette.neutral[500]) },
      benin: { value: color(palette.brand[500]) },
      rim: { value: color(palette.brand[300]) },
      glow: { value: 0 },
    },
  })
  const halo = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: atmosphere,
    uniforms: { rim: { value: color(palette.brand[500]) } },
    side: BackSide,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
  })
  map.colorSpace = SRGBColorSpace
  const sphere = new SphereGeometry(1, 96, 64)
  const shell = new SphereGeometry(1.07, 64, 48)

  const root = new Group()
  const spin = new Group()
  root.add(new Mesh(shell, halo), spin)
  spin.add(new Mesh(sphere, material))
  // Le Bénin face à la caméra (+z) : u = (lon + 180) / 360 sur la sphère de Three.
  spin.rotation.y = -((BENIN.lon + 90) * Math.PI) / 180
  root.rotation.x = (BENIN.lat * Math.PI) / 180

  return {
    root,
    spin,
    setGlow: (v) => (material.uniforms.glow!.value = v),
    dispose() {
      sphere.dispose()
      shell.dispose()
      material.dispose()
      halo.dispose()
      map.dispose()
    },
  }
}
