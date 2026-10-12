import type { OutputBundle, OutputChunk } from 'rolldown'
import type { Plugin } from 'vite'

/**
 * Préchargement de la page d'arrivée (build uniquement). Le chunk d'une route (découpage
 * automatique de TanStack Router) n'est demandé qu'après l'exécution du point d'entrée : un aller-
 * retour réseau de plus avant le premier rendu. Ce plugin inscrit dans index.html, pour la
 * connexion et le tableau de bord, la liste de leurs chunks ; un script en ligne de quelques
 * octets ajoute les `modulepreload` de la page demandée, en parallèle du point d'entrée. La police
 * principale est aussi préchargée (sinon découverte après la feuille de style).
 */
export function routePreload(routes: Record<string, RegExp>, font: RegExp): Plugin {
  return {
    name: 'gostation:route-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle as OutputBundle | undefined
        if (!bundle) return html
        const chunks = Object.values(bundle).filter((c): c is OutputChunk => c.type === 'chunk')
        const byName = new Map(chunks.map((c) => [c.fileName, c]))
        const inHtml = new Set([...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.js)"/g)].map((m) => m[1]))
        const closure = (start: OutputChunk) => {
          const seen = new Set<string>()
          const walk = (c: OutputChunk) => {
            if (seen.has(c.fileName) || inHtml.has(c.fileName)) return
            seen.add(c.fileName)
            c.imports.forEach((f) => byName.get(f) && walk(byName.get(f)!))
          }
          walk(start)
          return [...seen].map((f) => `/${f}`)
        }
        const map: Record<string, string[]> = {}
        for (const [path, re] of Object.entries(routes)) {
          const chunk = chunks.find((c) => c.facadeModuleId && re.test(c.facadeModuleId))
          if (chunk) map[path] = closure(chunk)
        }
        const fontFile = Object.keys(bundle).find((f) => font.test(f))
        const script = `(function(){var f=${JSON.stringify(map)}[location.pathname];if(!f)return;for(var i=0;i<f.length;i++){var l=document.createElement('link');l.rel='modulepreload';l.href=f[i];document.head.appendChild(l)}})()`
        return [
          ...(fontFile
            ? [
                {
                  tag: 'link',
                  attrs: { rel: 'preload', href: `/${fontFile}`, as: 'font', type: 'font/woff2', crossorigin: '' },
                  injectTo: 'head' as const,
                },
              ]
            : []),
          { tag: 'script', children: script, injectTo: 'head' as const },
        ]
      },
    },
  }
}
