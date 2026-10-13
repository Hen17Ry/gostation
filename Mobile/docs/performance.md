# Performance — app mobile

Objectifs (D50) : 60 fps sur les listes, la carte et les animations ; démarrage à froid < 2,5 s sur
un Android de milieu de gamme ; requêtes et tuiles minimisées.

## Méthode

- Build **release** (`npm run build:apk`), jamais le dev build (JS non optimisé, outils de debug).
- `npm run perf` : [Flashlight](https://github.com/bamlab/flashlight) rejoue les scénarios Maestro de
  `.maestro/perf/` (3 itérations, l'app est relancée à chaque fois) et relève FPS, CPU par thread et
  RAM toutes les 500 ms, **sur toute la durée du scénario** (jusqu'au relevé du 13/10 au matin :
  fenêtre fixe de 25 s, qui ne couvrait pas tous les balayages sur le téléphone). Synthèse affichée
  à la fin par `scripts/perf-summary.py` ; résultats dans `var/perf/`, rapport web par
  `~/.flashlight/bin/flashlight report var/perf/<scénario>.json`.
- Définitions : médiane, médiane et **minimum hors lancement** (sans les 10 premières mesures, soit
  5 s), moyenne, p5 (2ᵉ plus faible sur 51 mesures), CPU (somme des threads), RAM de Flashlight.
- Compilation du code Java/Kotlin, à noter avec chaque relevé (`adb shell dumpsys package dexopt`) :
  `verify` = interprété puis JIT (installation par adb sans profil), `speed-profile` = méthodes du
  profil de référence précompilées (installation depuis le Play Store, ou adb sur le S10 depuis que
  l'APK embarque `plugins/baseline-prof.txt`, raison `install-spqr-dm`).
- Démarrage à froid : `adb shell am start -W -n bj.gostation.app/.MainActivity` (`TotalTime`,
  médiane de 5 lancements après `force-stop`). L'écran de démarrage attend la première image de la
  carte (`src/lib/splash.ts`) ; Android 12 retient la première image de l'activité tant qu'il est
  affiché : `TotalTime` mesure donc le temps jusqu'à la carte dessinée.
- Profilage d'une image lente : `adb shell atrace --async_start -c -b 16384 -a bj.gostation.app gfx
view input sched freq` pendant un flux Maestro, `atrace --async_stop -z -o …`, puis analyse avec
  `trace_processor` (Perfetto ; `traced_probes` est arrêté sur ce Samsung) : sections Fabric
  (`MountItemDispatcher`, `createViewUnsafe`), dessin (`Record View#draw()`), entrées
  (`deliverInputEvent`), RenderThread (`DrawFrame`, `shader_compile`, `queueBuffer`).

## Relevé du 2026-10-13 (soir) — Galaxy S10, après corrections

Même téléphone et mêmes scénarios que le relevé du matin ci-dessous, mesurés sur toute leur durée ;
code compilé en `speed-profile` (profil de référence de l'APK). Série 1 : juste après
l'installation ; série 2 : à la suite, téléphone chaud (bridage thermique léger, peau à 37 °C).

| Scénario (série 1)                   | FPS médian | min hors lancement | FPS moyen   | p5      | CPU moyen | RAM moyenne  |
| ------------------------------------ | ---------- | ------------------ | ----------- | ------- | --------- | ------------ |
| Recherche + défilement des résultats | 59,9 à 60  | 45 à 51            | 58,7 à 58,9 | 51 à 52 | 49 à 51 % | 330 à 332 Mo |
| Itinéraire + navigation              | 60         | 44 à 47            | 58,9 à 59,1 | 48 à 54 | 49 à 52 % | 348 à 352 Mo |

Série 2 : recherche p5 50, minimum 38 à 44 ; navigation p5 49 à 54, minimum 44 à 50.

Scénario de recherche, minimum des échantillons de 500 ms à chaque moment (3 passes) :

| Moment                                 | Matin (fenêtre de 25 s) | Soir, série 1 | Soir, série 2 (chaud) |
| -------------------------------------- | ----------------------- | ------------- | --------------------- |
| Lancement (sous l'écran de démarrage)  | 23 à 36                 | 50 à 51       | 33 à 48               |
| Arrivée des résultats                  | 46 à 53                 | 52 à 56       | 49 à 53               |
| Premier glissement du panneau (≈ 11 s) | 38 à 42                 | 45 à 51       | 38 à 44               |
| Balayages suivants                     | 48 à 52                 | 50 à 51       | 50                    |

Le relevé du matin attribuait le creux de 38 à 42 FPS à l'arrivée des résultats : découpé par
moment, il tombe au premier glissement du panneau, l'arrivée étant à 46 à 53.

Démarrage à froid jusqu'à la carte dessinée : médiane 1,35 s (1,28 à 1,89 s).

**Reste sous 50 FPS** : le premier glissement du panneau. Le thread principal y traite les gestes
deux fois plus longtemps qu'aux balayages suivants (111 ms d'entrées sur le geste, dont 26 ms pour le
premier événement, contre 59 ms ; 80 ms d'animation contre 25) : première exécution des worklets du
panneau (gorhom, Reanimated, Gesture Handler), que Reanimated évalue depuis leur source au premier
appel. Piste : le mode « bundle » des worklets (expérimental). En navigation, les creux (44 à 48)
tombent au démarrage du guidage (caméra inclinée qui suit la position).

**RAM** : PSS ≈ 240 Mo après le scénario de recherche (`dumpsys meminfo`) : code projeté 75 à 85 Mo
(pages propres des `.so`, du dex et de l'APK), tas natif ≈ 75 Mo (Hermes, MapLibre, React Native),
graphismes 28 Mo, Java 20 à 28 Mo. Flashlight affiche 330 à 350 Mo (pages partagées comprises), dont
≈ 15 Mo de code précompilé par le profil. Le cache d'images n'en est pas la cause (aucune `<Image>`,
cache Fresco vide), ni celui des tuiles : préchargement (4 niveaux de zoom) et cache de tuiles en
mémoire de MapLibre coupés pour l'essai (patch temporaire), tas natif 72 à 76 Mo contre 75, PSS
inchangé ; ils restent aux valeurs par défaut. Le cache ambiant de 80 Mo est sur le disque.

## Relevé du 2026-10-13 (matin) — Galaxy S10, avant corrections

Samsung Galaxy S10 (SM-G973F, Exynos 9820, 8 Go de RAM, Android 12, 1080 × 2280), build release
arm64-v8a, mode « Ne pas déranger », position simulée à Cotonou par Maestro. C'est un ancien haut de
gamme (2019), plus puissant que la cible D50 (2 à 3 Go) : **la mesure sur un Android d'entrée ou de
milieu de gamme reste à faire**. Trois itérations par scénario, mêmes définitions que le relevé
émulateur ci-dessous (p5 = 2ᵉ plus faible des 51 mesures, « hors lancement » = sans les 10 premières).

| Scénario                             | FPS médian | FPS médian hors lancement | FPS moyen   | p5      | CPU moyen | RAM moyenne  |
| ------------------------------------ | ---------- | ------------------------- | ----------- | ------- | --------- | ------------ |
| Recherche + défilement des résultats | 59,9       | 59,9                      | 57,6 à 57,8 | 38 à 42 | 63 à 66 % | 313 à 321 Mo |
| Itinéraire + navigation              | 59,9       | 59,9                      | 57,4 à 58,4 | 37 à 47 | 66 à 73 % | 325 à 332 Mo |

Démarrage à froid : médiane 0,92 s (5 lancements, 0,90 à 0,95 s).

La médiane tient 60 FPS dans les deux scénarios. Les creux reviennent au même moment à chaque
itération : lancement (≈ 1,5 s, 23 à 36 FPS), recherche (≈ 8,5 s), vers 11 à 12 s (38 à 42 FPS ;
premier glissement du panneau, cf. relevé du soir), puis début de chaque balayage (47 à 55 FPS sur l'échantillon de 500 ms, avec un
pic du thread JS). Maestro est plus lent sur le téléphone que sur l'émulateur (≈ 50 s par itération
de recherche contre 33 s) : la fenêtre de 25 s couvre le lancement, la recherche et environ la moitié
des balayages. La RAM est plus élevée que sur l'émulateur (≈ 315 à 330 Mo contre ≈ 275 Mo).

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

Relevé du 13/10 (S10, profilage `atrace`) :

- **Toucher « Rechercher »** : la création de l'`ActivityIndicator` natif du bouton occupé coûtait
  30 à 46 ms au thread principal (image perdue à l'appui). Remplacé par `Spinner`, un anneau
  Reanimated d'une seule vue.
- **Arrivée des résultats** : créer les vues de toutes les cartes dans la même image coûtait
  140 ms. `ResultsList` monte les deux cartes visibles au cran du milieu, puis les autres une par
  image une fois le panneau et la caméra posés (650 ms) ; la distance de rendu couvre toute la liste
  (10 à 20 résultats), les cartes ne sont plus recyclées : pendant le défilement, ni rendu JS ni
  mise à jour des textes.
- **Balayages** : chaque balayage partait d'une carte et déclenchait l'ondulation d'Android 12,
  animée par la RenderThread (shader GPU) pendant tout le geste. État appuyé retardé de 130 ms
  (`unstable_pressDelay`, comme Android) : un balayage reste un défilement.
- **Code interprété** : installé par adb, le code Java/Kotlin de React Native, de react-native-svg,
  de MapLibre et de Reanimated était interprété puis compilé à chaud (`verify`) : premiers usages
  très lents (montage, texte, gestes). Profil de référence ART (`plugins/baseline-prof.txt`, posé
  par `plugins/with-baseline-profile.js`) : ces bibliothèques sont précompilées à l'installation
  (21 → 12 images longues sur le scénario de recherche, plus aucune pendant les balayages).
- **Lancement** : l'écran de démarrage reste affiché jusqu'à la première image de la carte (2,5 s au
  plus), qui cache le creux de la création de la carte.

Avant :

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
