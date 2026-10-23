/**
 * Thème de l'en-tête d'après ce qu'il recouvre (tous les modes, sans GSAP) : le dernier élément à
 * data-theme (page, night, brand) qui couvre le point juste sous la barre, dans l'ordre du
 * document (donc peint au-dessus) ; la barre prend le même (verre clair, verre sombre, contraste
 * net sur l'orange). Le bandeau qui envahit l'écran porte data-theme="brand" : la barre change au
 * moment exact où il passe dessous. Test géométrique, pas elementFromPoint : une scène qui ne
 * reçoit pas les clics (le problème, qui chevauche l'ouverture) compte aussi.
 */
export function headerTone() {
  const header = document.querySelector<HTMLElement>('[data-site-header]')
  const bar = header?.querySelector<HTMLElement>('.header-bar')
  if (!header || !bar) return
  const themed = [...document.querySelectorAll<HTMLElement>('main [data-theme]')]
  let frame = 0
  let settle = 0
  const update = () => {
    frame = 0
    const x = window.innerWidth / 2
    const y = bar.getBoundingClientRect().bottom + 6
    let theme = 'page'
    for (const el of themed) {
      const r = el.getBoundingClientRect()
      if (r.top > y || r.bottom < y || r.left > x || r.right < x) continue
      if (getComputedStyle(el).visibility === 'hidden') continue
      theme = el.dataset.theme ?? theme
    }
    if (header.dataset.tone !== theme) header.dataset.tone = theme
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update)
    // Les animations liées au défilement s'amortissent après l'arrêt (scrub) : nouvelles lectures
    // pendant 1,2 s, le temps que le bandeau ou une section finisse d'arriver sous la barre.
    window.clearInterval(settle)
    let left = 12
    settle = window.setInterval(() => {
      update()
      if (--left <= 0) window.clearInterval(settle)
    }, 100)
  }
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  // Une scène qui change de thème sans défilement (fin d'animation) le signale.
  document.addEventListener('gs:theme', schedule)
  schedule()
}
