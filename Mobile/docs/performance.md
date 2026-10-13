# Performance — app mobile

Objectifs (D50) : 60 fps sur les listes, la carte et les animations ; démarrage à froid < 2,5 s sur
un Android de milieu de gamme ; requêtes et tuiles minimisées.

## Méthode

- Build **release** (`npm run build:apk`), jamais le dev build (JS non optimisé, outils de debug).
- `npm run perf` : [Flashlight](https://github.com/bamlab/flashlight) rejoue les scénarios Maestro de
  `.maestro/perf/` (3 itérations de 25 s, l'app est relancée à chaque fois) et relève FPS, CPU par
  thread et RAM toutes les 500 ms. Résultats dans `var/perf/`, rapport web par
  `~/.flashlight/bin/flashlight report var/perf/<scénario>.json`.
- Démarrage à froid : `adb shell am start -W -n bj.gostation.app/.MainActivity` (`TotalTime`,
  médiane de 5 lancements après `force-stop`).

## Relevé du 2026-10-13 — build final, émulateur (le téléphone n'était pas branché)

Émulateur Android 16 x86_64, 2 Go de RAM, GPU de l'hôte, build release final (1 rem = 16 dp, D57).
**Ces chiffres ne remplacent pas une mesure sur un téléphone de milieu de gamme**, à refaire dès
qu'il est branché. Trois itérations par scénario ; « hors lancement » écarte les 5 premières
secondes (démarrage à froid, chargement du style de carte).

| Scénario                             | FPS médian  | FPS médian hors lancement | FPS moyen   | p5      | CPU moyen | RAM moyenne  |
| ------------------------------------ | ----------- | ------------------------- | ----------- | ------- | --------- | ------------ |
| Recherche + défilement des résultats | 58,2 à 58,4 | 58,4 à 59,1               | 53,5 à 53,9 | 31 à 33 | 71 à 74 % | 275 à 281 Mo |
| Itinéraire + navigation              | 59,6 à 60   | 59,8 à 60                 | 54,0 à 56,4 | 29 à 40 | 79 à 83 % | 264 à 284 Mo |

Démarrage à froid : médiane 1,55 s (5 lancements, 1,45 à 1,88 s).

Les creux restants (p5 autour de 30 FPS) se produisent au lancement, à l'arrivée des résultats et
pendant les balayages rapides du scénario, qui peuvent aussi faire changer le panneau de cran. Sur
l'émulateur, le rendu de la carte partage le GPU de l'hôte : la cible de 60 FPS reste à vérifier
sur un téléphone de milieu de gamme avant de conclure.

## Corrections issues des mesures

- **Rendu continu de la carte** : la puce de position native de MapLibre, animée en permanence,
  faisait tourner le thread de rendu de la carte à 100 % d'un cœur, même sous un autre onglet. Elle
  est remplacée hors navigation par la puce JS, redessinée après 10 m de déplacement : CPU moyen du
  scénario de recherche divisé par deux (136 % → 66 %), carte au repos ≈ 0 %.
- **Cartes de résultats** : `Pressable` natif (ripple) au lieu de deux zones animées Reanimated par
  cellule.
- **Arrivée des résultats** : la liste se monte d'abord, le panneau et la caméra s'animent deux images
  plus tard.
- **Bundle** : 6,6 → 5,7 Mo de bytecode Hermes (icônes lucide importées une par une, instructions
  OSRM en français seulement, résolveur zod/mini maison au lieu de `@hookform/resolvers`).
