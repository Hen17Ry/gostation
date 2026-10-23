/**
 * Scène 5 — Le gérant (storyboard §2) : la ville s'éteint, fond braise ; le téléphone fait un
 * tour complet (on voit son dos) et revient sur l'écran Stocks ; le rappel des 4 h arrive, le
 * gérant met à jour (+), puis confirme d'un geste (« Rien n'a changé »).
 */
import type { Screen } from '../../phone/painter'
import { backdrop } from '../backdrop'
import type { Rigs } from '../rigs'
import { end, local, pinned, steps } from './common'

function screenAt(p: number): Screen {
  const tap = (x: number, y: number, a: number, b: number) => ({ x, y, t: local(p, a, b) })
  // Avant le demi-tour : l'écran d'arrivée de la scène 4 (on le voit de face).
  if (p < 0.12) return { kind: 'arrived' }
  const reminder = p < 0.22 ? 0 : p < 0.34 ? local(p, 0.22, 0.34) : p < 0.4 ? 1 : 0
  const base = { kind: 'stocks' as const, count: p < 0.48 ? 13 : 14, confirmed: p >= 0.65, reminder }
  if (p >= 0.36 && p < 0.4) return { ...base, tap: tap(64, 176, 0.36, 0.4) }
  if (p >= 0.44 && p < 0.5) return { ...base, tap: tap(319, 202, 0.44, 0.5) }
  if (p >= 0.6 && p < 0.66) return { ...base, tap: tap(180, 675, 0.6, 0.66) }
  return base
}

export function managers(rigs: Rigs, mm: gsap.MatchMedia) {
  const section = document.querySelector<HTMLElement>('[data-scene="managers"]')
  if (!section) return
  const items = [...section.querySelectorAll<HTMLElement>('[data-steps] > li')]
  const cta = section.querySelector<HTMLElement>('[data-managers-cta]')
  const { phone, city } = rigs

  mm.add({ mobile: '(max-width: 767px)', desktop: '(min-width: 768px)' }, (ctx) => {
    const mobile = !!ctx.conditions?.mobile
    const tl = pinned(section, (p) => phone.setScreen(screenAt(p), 3, p))

    tl.fromTo(backdrop.w, { emberIn: 0 }, { emberIn: 1, duration: 0.2, onUpdate: backdrop.apply }, 0)
      .fromTo(city.poses.out, { opacity: 1 }, { opacity: 0, duration: 0.14, onUpdate: city.apply }, 0)
      // Un tour complet : le dos (logo) passe à mi-course, l'écran Stocks revient de face.
      .fromTo(
        phone.poses.flip,
        { rotY: 0, x: 0, y: 0, scale: 1 },
        {
          rotY: 360,
          // Compense la pose de la scène 4 (téléphone décalé et réduit) : il revient au centre.
          x: mobile ? 0 : () => -window.innerWidth * 0.03,
          y: mobile ? () => -window.innerHeight * 0.2 : 0,
          scale: mobile ? 1.28 : 1.1,
          duration: 0.24,
          ease: 'power2.inOut',
          onUpdate: phone.apply,
        },
        0,
      )
    if (cta) tl.fromTo(cta, { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.05 }, 0.8)

    steps(tl, items, [0.22, 0.42, 0.58, 0.78])
    end(tl)
  })
}
