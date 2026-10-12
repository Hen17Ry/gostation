# Design system — GoStation mobile

La carte est l'écran principal ; tout le reste l'accompagne. L'app doit se comprendre en un coup
d'œil, debout à côté d'une moto ou au volant, sur un Android d'entrée de gamme et une data chère :
une seule couleur d'accent (l'orange GoStation), des neutres légèrement chauds, de grandes cibles,
des retours immédiats, aucune animation qui ralentit. Déclinaison mobile du design system de
l'admin ([`Web/docs/design-system.md`](../../Web/docs/design-system.md)), établie avec le skill
`ui-ux-pro-max` (règles natives : cibles, zones sûres, haptique, mouvement, accessibilité).

- **Source unique des couleurs** : `Web/src/styles/globals.css`, convertie par
  `npm run gen:tokens` en [`src/theme/tokens.generated.ts`](../src/theme/tokens.generated.ts) (et
  `tokens.cjs` pour Tailwind). Rien n'est recopié à la main.
- **Vitrine** : écran `/design` (développement uniquement, Compte → Design system) : palette, rôles,
  typographie, composants, élévations, retours haptiques, dans le thème courant.
- **Vérifications** : [`src/theme/tokens.test.ts`](../src/theme/tokens.test.ts) (52 contrastes WCAG
  AA, clair et sombre) ; ESLint refuse toute couleur brute hors de `src/theme`.
- **Captures** : [`docs/screenshots/`](screenshots) (téléphone, clair et sombre).

## 1. Tokens et thème

| Niveau             | Où                                       | Exemple                                 |
| ------------------ | ---------------------------------------- | --------------------------------------- |
| Primitives         | `tokens.brand`, `tokens.neutral`         | `brand[600]` `#d14200`, `neutral[100]`  |
| Rôles sémantiques  | `tokens.light`, `tokens.dark` (43 rôles) | `primary`, `muted-foreground`, `border` |
| Classes NativeWind | variables `--rôle` posées par le thème   | `bg-primary`, `text-muted-foreground`   |
| Valeurs hex        | `useTheme().colors`                      | carte MapLibre, icônes, barres système  |

Le thème suit le système (clair ou sombre), sans bascule dans l'app en V1. `ThemeProvider` pose les
variables du thème courant ; un composant n'écrit jamais `#d14200` mais `bg-primary` ou
`colors.primary`. Le sombre n'est pas une inversion : chaque rôle y est choisi pour le fond sombre
(primaire 500 avec texte 950, texte de marque 400).

### Contrastes clés

| Couple                                  | Clair | Sombre |
| --------------------------------------- | ----- | ------ |
| `foreground` / `background`             | 18,98 | 18,98  |
| `muted-foreground` / `surface`          | 6,81  | 7,20   |
| `primary-foreground` / `primary`        | 4,68  | 5,55   |
| `brand-text` / `background`             | 5,96  | 8,76   |
| `input` (contour) / `surface`           | 3,37  | 3,10   |
| `primary` (marqueur, contour) / surface | 4,68  | 6,51   |

Un état ne passe jamais par la couleur seule : « Ouverte », « À vérifier », « Signalée » sont des
badges avec texte (et icône), le rang des stations est écrit dans le marqueur.

## 2. Typographie

Geist embarquée dans l'app (plugin `expo-font`, aucun téléchargement), **une famille par graisse**
(`Geist_400Regular`, `_500Medium`, `_600SemiBold`, `_700Bold`, `GeistMono_500Medium`) : Android ne
synthétise pas les graisses d'une police embarquée. Composant [`Text`](../src/components/ui/text.tsx).

| Variante   | Taille / interligne (dp) | Graisse | Usage                                    |
| ---------- | ------------------------ | ------- | ---------------------------------------- |
| `display`  | 34 / 40                  | 700     | rare (accueil)                           |
| `title1`   | 28 / 34                  | 700     | titre d'écran, durée de l'itinéraire     |
| `title2`   | 24 / 30                  | 600     | distance de la manœuvre, heure d'arrivée |
| `title3`   | 20 / 26                  | 600     | titre de panneau                         |
| `headline` | 17 / 22                  | 600     | nom de station, libellé de bouton        |
| `body`     | 16 / 24                  | 400     | texte courant, champs                    |
| `callout`  | 15 / 20                  | 400     | sous-titres                              |
| `subhead`  | 14 / 20                  | 400     | lignes secondaires, puces                |
| `footnote` | 13 / 18                  | 400     | aides, métadonnées                       |
| `caption`  | 12 / 16                  | 500     | « mis à jour il y a », badges (minimum)  |

Taille dynamique respectée (`allowFontScaling`), plafonnée à ×1,8 (×1,6 dans les champs, ×1,3 dans la
barre d'onglets) pour garder les écrans utilisables. Chiffres des horaires en Geist Mono.

## 3. Espacements, rayons, élévations

- **Grille de 4 dp.** Marges d'écran 20 dp, marge interne des cartes 16 dp, écart entre blocs 20 dp,
  entre éléments liés 8 à 12 dp.
- **Rayons** : 4 (`xs`), 6 (`sm`), 10 (`md`), 12 (`lg`, champs et boutons), 16 (`xl`, cartes), 20
  (`2xl`), 28 (`3xl`, panneau d'itinéraire), plein (`full`, puces, boutons ronds). Le bottom sheet a
  des coins de 24 dp.
- **Élévations natives** ([`elevation.ts`](../src/theme/elevation.ts)) : Android `elevation`, iOS
  ombre douce teintée chaude.

| Niveau | Android | Usage                                                           |
| ------ | ------- | --------------------------------------------------------------- |
| 1      | 2       | cartes de contenu                                               |
| 2      | 6       | boutons et pastilles posés sur la carte                         |
| 3      | 12      | bottom sheet, bandeau de manœuvre, panneau d'itinéraire, toasts |

En sombre, la hiérarchie passe aussi par la surface (`card` < `popover`).

## 4. Interaction

- **Cibles ≥ 48 dp** : boutons 48 (`md`) ou 56 (`lg`) ; `sm` (40) avec `hitSlop` pour atteindre 48 ;
  boutons icône 48 × 48 ; lignes de liste ≥ 56 ; grandes tuiles de produit 88.
- **Retour immédiat** : [`PressableScale`](../src/components/ui/pressable-scale.tsx) réduit l'élément
  à 0,97 par un ressort sur le thread UI, sans décaler la mise en page ; ripple Android sur les
  lignes de liste.
- **Chargement** : tout bouton qui déclenche un appel passe en état occupé (indicateur, `busy`
  annoncé, appuis ignorés) ; squelettes aux dimensions du contenu final (aucun saut).
- **Erreurs** : sous le champ concerné (annoncées), message général en bandeau ; messages issus du
  `code` de l'API, jamais du texte technique.

## 5. Mouvement

[`motion.ts`](../src/theme/motion.ts) : durées 120 / 200 / 320 ms, sortie `cubic-bezier(0.23, 1,
0.32, 1)`, ressorts « vif » (appui) et « souple » (panneaux). **Transform et opacité seulement**
(jamais de largeur ni de hauteur animée), sur le thread UI (Reanimated 4). Avec « réduire les
animations », les ressorts d'appui sont coupés, les ondes de recherche deviennent une pulsation
fixe, les squelettes ne clignotent plus.

| Animation           | Détail                                                                                                                                             |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recherche           | 3 ondes partent du point de recherche et s'élargissent (1,8 s, décalées) : le rayon de l'API qui grandit                                           |
| Bottom sheet        | 3 crans (choix du produit, moitié, plein écran), suivi au doigt (gorhom, thread UI) ; le bouton « ma position » le suit et s'efface quand il monte |
| Accueil             | défilement horizontal, illustration en parallaxe, points de progression                                                                            |
| Bandeau de manœuvre | fondu à chaque étape                                                                                                                               |
| Toasts              | entrée par le bas, sortie plus rapide                                                                                                              |

## 6. Haptique

Parcimonieuse ([`haptics.ts`](../src/lib/haptics.ts)) : `selection` au changement d'un choix
(produit, taille, motif, onglet, interrupteur), `light` au lancement d'une recherche ou du guidage,
`success` (résultats, favori, code vérifié, arrivée), `warning` (aucun résultat), `error` (échec).
Jamais à chaque toucher.

## 7. Composants

Dans [`src/components/ui/`](../src/components/ui) : `Text`, `Button` (primaire, secondaire,
contour, fantôme, destructif ; 3 tailles), `IconButton` (posé sur la carte : `floating`),
`PressableScale`, `ChoiceTile` et `Chip` (choix radio), `TextField` (libellé visible, aide, erreur,
afficher/masquer le mot de passe), `OtpInput` (6 cases, un seul champ natif : saisie automatique et
collage), `Badge`, `Banner`, `Card`, `Section`, `ListRow`, `SwitchRow`, `Skeleton`, `EmptyState` et
ses illustrations, `Toast`, `Screen` (zones sûres, en-tête, pied collant, clavier), `TabScreen`.
Domaine : `ResultCard`, `ProductPicker`, `SearchPulse`, `StationsMap`, `RouteMap`.

**Composants animés et classes.** NativeWind (css-interop) ne doit jamais recevoir un style
Reanimated : il l'aplatirait en objet ordinaire (valeurs lues pendant le rendu, classes et animation
perdues). Un composant animé qui porte des classes vient donc de
[`src/lib/animated.tsx`](../src/lib/animated.tsx) (`AnimatedView`, `AnimatedPressable`) : les
classes y sont résolues à part puis passées avant le style animé. Jamais de `className` sur
`Animated.View` directement. De même, deux classes en conflit (`p-4` et `p-0`) ne se départagent pas
par leur ordre : `Card` a une option `flush` plutôt qu'une surcharge. Les liens texte utilisent la
variante `link` de `Button` (alignés sur le texte voisin, zone tactile élargie).

## 8. Carte

- **Style** : OpenFreeMap Positron recoloré aux tokens par `npm run gen:map-styles` (fond
  `neutral-100`, eau et parcs désaturés, grands axes teintés `brand-50/200` ; version sombre
  dédiée). Écussons de routes et pastilles de villes retirés : **pas de sprite**, pas de relief
  raster, donc moins de requêtes.
- **Marqueurs** : couches natives d'une source GeoJSON regroupée (`cluster`, rayon 42 px) : pastille
  orange avec le rang (ouverte), grise (fermée), halo sur la station choisie, nombre dans les
  groupes. Aucune vue React par marqueur : la carte reste à 60 fps.
- **Économie de data** : caméra limitée au Bénin et ses abords, zoom 5,5 à 18, cache ambiant de
  80 Mo réutilisé entre les sessions.
- Rotation et inclinaison coupées pendant la recherche ; en navigation, la caméra suit la position
  et le cap (inclinaison 45°).

## 9. Accessibilité

Libellé sur chaque élément interactif (le libellé visible fait office de nom), rôles (`button`,
`radio`, `tab`, `switch`, `header`), états annoncés (sélectionné, coché, occupé), carte de résultat
résumée en une phrase (rang, nom, trajet, quantité, ouverture, fraîcheur, badges), changements
annoncés (`accessibilityLiveRegion` : résultats, bandeau de manœuvre, erreurs, toasts). Illustrations
et décors masqués aux lecteurs d'écran. Contrastes AA vérifiés par test.

## 10. Icône et écran de démarrage

Marque commune avec l'admin : épingle de station blanche portant un éclair (« disponible tout de
suite »), sur une pastille orange en dégradé 500 → 700. Sources SVG dans
[`assets/brand/`](../assets/brand) (`logo.svg`, `icon.svg`, avant-plan et monochrome de l'icône
adaptative Android) ; `npm run gen:icons` produit les PNG d'`assets/images/`. Démarrage : pastille
de 120 dp sur `background` (clair `#fbfaf9`, sombre `#0b0a09`), masquée dès que la session locale
est lue (aucun appel réseau avant le premier affichage).
