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
- **Captures** : [`docs/screenshots/`](screenshots) (clair et sombre ; index et régénération dans
  [`screenshots/README.md`](screenshots/README.md)).

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
barre d'onglets) pour garder les écrans utilisables. Chiffres des horaires et du code en Geist Mono
(prop `mono`).

Police et couleur passent par les props de `Text` (`weight`, `mono`, `tone`), jamais par `className`,
réservé à la mise en page : deux classes de même propriété ne se départagent que par l'ordre de la
feuille générée. ESLint refuse une classe `font-*` ou de couleur sur un `<Text>`.

## 3. Espacements, rayons, élévations

- **Grille de 4 dp.** Marges d'écran 20 dp, marge interne des cartes 16 dp, écart entre blocs 20 dp,
  entre éléments liés 8 à 12 dp. Les classes Tailwind valent ici ce qu'elles valent sur le web :
  1 rem = 16 dp (`inlineRem` de NativeWind, 14 par défaut, fixé dans `metro.config.js`), donc
  `p-4` = 16 dp et `h-12` = 48 dp.
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
- **Chargement** : tout bouton qui déclenche un appel passe en état occupé (`busy` annoncé, appuis
  ignorés) avec [`Spinner`](../src/components/ui/spinner.tsx), un anneau qui tourne sur le thread
  UI : jamais l'`ActivityIndicator` natif, dont la création coûte 30 à 46 ms au moment de l'appui ;
  squelettes aux dimensions du contenu final (aucun saut).
- **Listes qui défilent** : état appuyé retardé de 130 ms sur les cartes de résultats
  (`unstable_pressDelay`, comme Android) : un balayage qui part d'une carte ne déclenche pas
  l'ondulation d'Android 12, animée par le GPU pendant tout le geste ; un toucher bref la montre.
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
contour, fantôme, destructif ; 3 tailles ; `iconOnly` : carré, libellé lu par le lecteur d'écran), `IconButton` (posé sur la carte : `floating`),
`PressableScale`, `Spinner`, `ChoiceTile` et `Chip` (choix radio), `TextField` (libellé visible, aide, erreur,
afficher/masquer le mot de passe), `OtpInput` (6 cases, un seul champ natif : saisie automatique et
collage), `Badge`, `Banner`, `Card`, `Section` (lignes sur une carte ; `bare` : intitulé seul au-dessus de cartes, filtres ou texte), `ListRow`, `SwitchRow`, `Skeleton`, `EmptyState` et
ses illustrations, `Toast`, `Screen` (zones sûres, en-tête, pied collant, clavier ; sans pied, le
contenu finit au-dessus de la barre de navigation du système), `TabScreen`, `Stepper` (compteur
+/−), `SegmentedProgress` (formulaire en étapes), `TimeField` et `DateField` (sélecteurs natifs).
Domaine : `ResultCard`, `ResultsList` (cartes montées par étapes : deux avec les résultats, les
autres une par image après l'ouverture du panneau, puis plus de recyclage pendant le défilement),
`ProductPicker`, `SearchPulse`, `StationsMap`, `RouteMap`, `MapAttribution`. Espace gérant (section 11) : `StockRow`, `SetupChecklist`, `DocumentField`, `StationForm`.

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
  orange avec le rang (ouverte), grise (fermée), halo sur la station choisie. Un groupe s'affiche
  en pile de pastilles portant le meilleur rang qu'il contient (un nombre de stations s'y lirait
  comme un rang, cf. `src/map/markers.ts`) ; le toucher zoome dessus. Aucune vue React par
  marqueur : la carte reste à 60 fps.
- **Économie de data** : caméra limitée au Bénin et ses abords, zoom 5,5 à 18, cache ambiant de
  80 Mo réutilisé entre les sessions.
- **Crédits** : [`MapAttribution`](../src/map/attribution.tsx) remplace le bouton ⓘ natif de
  MapLibre (21 dp) : pastille « © OpenStreetMap · OpenFreeMap » toujours visible sur la carte, dans
  une cible de 48 dp de haut ; le toucher ouvre les sources (OpenStreetMap et sa licence ODbL,
  OpenFreeMap, OpenMapTiles). Accueil : posée sur le panneau à gauche, face à « ma position » ;
  itinéraire : au-dessus du panneau du bas.
- Rotation et inclinaison coupées pendant la recherche ; en navigation, la caméra suit la position
  et le cap (inclinaison 45°).

## 9. Accessibilité

Vérification : `npm run a11y` ouvre chaque écran par lien profond, extrait son arbre
d'accessibilité et signale tout élément actionnable sans nom ou de moins de 48 dp, puis capture les
écrans principaux en police ×1,5 (`var/a11y/`). Dernier audit (2026-10-13, émulateur) : aucun
élément sans nom ; les cibles signalées sous 48 dp (liens de 40 dp, puces de 44 dp, « Passer »)
atteignent 48 dp avec leur `hitSlop`, que l'arbre n'indique pas. Les crédits de la carte, d'abord
dessinés par MapLibre (bouton ⓘ de 21 dp), sont devenus une cible de 48 dp (`MapAttribution`).

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
de 120 dp sur `background` (clair `#fbfaf9`, sombre `#0b0a09`), masquée quand la session locale
est lue (aucun appel réseau avant le premier affichage) et, si l'app s'ouvre sur la carte, après sa
première image complète, 2,5 s au plus ([`src/lib/splash.ts`](../src/lib/splash.ts)) : le creux
d'images du lancement (création de la carte) reste sous l'écran de démarrage.

## 11. Espace gérant

Même design system, d'autres usages : un gérant met ses stocks à jour debout, entre deux clients,
souvent d'une main. Captures 50 à 69 ([`screenshots/`](screenshots)).

- **Navigation** (D58) : station approuvée, 5 onglets (Stocks, Ma station, Signalements,
  Notifications, Compte ; libellés réduits jusqu'à 80 % plutôt que tronqués sur 360 dp) ; dossier
  en attente, refusé ou suspendu, un seul écran de statut (icône et couleur d'état doublées d'un
  titre, motif en carte, actions en boutons pleine largeur).
- **Saisie des stocks** (D59) : une carte par produit. Bouteilles : [`Stepper`](../src/components/ui/stepper.tsx),
  − et + de 56 dp aux bords (pouces), nombre en Geist Mono 24 au centre, modifiable au toucher
  (pavé numérique) ; appui long : 1, puis 5, puis 10 par pas ; en butée (0, plafond), tremblement
  de 4 × 50 ms et retour haptique « warning ». Litres : champ au pavé numérique, séparateurs de
  milliers pendant la saisie. Un produit modifié prend un contour `primary` et un fond
  `primary-subtle` : on voit d'un coup d'œil ce qui partira. « Rupture » en pastille de 40 dp
  (48 dp avec `hitSlop`). Bouton principal collant : « Rien n'a changé » sans modification,
  « Enregistrer · N changements » sinon, qui ouvre le récapitulatif (avant → après, sur deux lignes
  pour les écrans étroits). Lecteur d'écran : le compteur est un élément réglable (glisser vers le
  haut ou le bas), le double toucher ouvre la saisie directe.
- **Conflit (412)** : feuille « Les stocks ont changé entre-temps », trois cases par produit
  (Avant, Maintenant, Votre saisie, la saisie en `brand-text`), un seul bouton « Recharger en
  gardant ma saisie ».
- **Hors connexion** (D60) : bandeau d'information, ligne « Changements non envoyés gardés » au-dessus
  du bouton désactivé ; au retour du réseau, bandeau de succès avec « Vérifier et envoyer ».
- **Épinglage** (D64) : carte plein écran, épingle `primary` de 48 dp fixe au centre (sa pointe
  est le point envoyé), avertissement toujours visible en haut (« Placez l'épingle sur la station,
  pas sur vous »), panneau du bas avec un seul bouton ; position active en point gris, déplacement
  demandé en anneau `primary`.
- **Formulaires** : [`SegmentedProgress`](../src/components/ui/segmented-progress.tsx) (« Étape 2
  sur 3 » et un segment par étape), titre d'étape qui reçoit le focus du lecteur d'écran, retour
  d'Android vers l'étape précédente ; compteur de chiffres dans l'aide de l'IFU (« 8/13 ») ;
  justificatif en zone pointillée puis aperçu (image, ou fiche du PDF), boutons photo et fichier
  empilés en pleine largeur ; pied « ← » (icône seule, « Précédent » pour le lecteur d'écran) et
  « Suivant » ou « Envoyer mon dossier » ; dialogue natif avant un
  changement d'IFU ou de RCCM et avant toute suppression.
- **Horaires** : une carte par jour (interrupteur ouvert/fermé, 24 h/24, plages en `TimeField`
  côte à côte, « le lendemain » sous une plage qui passe minuit), « Copier sur tous les jours »
  en bouton fantôme ; fermetures en liste avec suppression confirmée.

## 12. Notifications (9C)

Captures 70 à 74 ([`screenshots/`](screenshots)).

- **Explication des rappels** (D70) : écran plein en modale (glisse du bas), montré une fois au
  gérant juste après la validation de sa station, avant la demande du système. Pastille `BellRing`
  sur `primary-subtle`, titre, puis trois raisons (icône en pastille `muted`, titre en `headline`,
  texte en `subhead` `muted`) : pourquoi, quand et à quelle fréquence, comment répondre ou couper.
  Pied collant : bouton principal « Activer les rappels » (« C'est compris » si l'autorisation est
  déjà accordée, « Ouvrir les réglages » après un refus définitif) et « Plus tard » en fantôme.
- **Autorisation refusée** : [`PushDeniedBanner`](../src/features/notifications/push-denied-banner.tsx),
  `Banner` d'information (jamais d'alerte rouge : rien n'est cassé) avec un bouton contour « Ouvrir
  les réglages », en haut de Stocks (gérant) et de Favoris (utilisateur ayant une alerte active).
- **Push reçu app ouverte** (D73) : aucune notification système ; `toast.info` composé d'après le
  type (même texte que la boîte de réception), compteur de l'onglet Notifications à jour.
- **Notification système** : petite icône blanche monochrome (épingle et éclair), accent orange
  brand 600 ; rappel avec ses deux actions « Mettre à jour » et « Rien n'a changé » ; confirmation
  sur un canal silencieux, qui remplace le rappel dans le volet.
