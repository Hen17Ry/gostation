/**
 * Thème de l'en-tête d'après ce qu'il recouvre (tous les modes, sans GSAP) : l'élément juste sous
 * la barre porte, lui ou un parent, un data-theme (page, night, brand) ; la barre prend le même
 * (verre clair, verre sombre, contraste net sur l'orange). Le bandeau qui envahit l'écran porte
 * data-theme="brand" : la barre change au moment exact où il passe dessous.
 */
export function headerTone() {
  const header = document.querySelector<HTMLElement>('[data-site-header]')
  const bar = header?.querySelector<HTMLElement>('.header-bar')
  if (!header || !bar) return
  let frame = 0
  let settle = 0
  const update = () => {
    frame = 0
    const rect = bar.getBoundingClientRect()
    const hit = document.elementFromPoint(window.innerWidth / 2, rect.bottom + 6)
    const theme = hit?.closest<HTMLElement>('[data-theme]')?.dataset.theme ?? 'page'
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
