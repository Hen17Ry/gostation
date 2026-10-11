# Design system — GoStation Admin

Back-office premium, épuré, dense mais aéré : des données lisibles d'un coup d'œil, une seule couleur
d'accent (l'orange GoStation), des neutres légèrement chauds, aucune décoration qui ne porte pas
d'information. Direction établie avec le skill `ui-ux-pro-max` (style « Minimalism & Swiss »,
densité dashboard), palette et graphiques validés avec la méthode `dataviz`.

- **Source unique** : [`src/styles/globals.css`](../src/styles/globals.css).
- **Vitrine** : page `/design` (développement uniquement, absente du build de production) : tous les
  tokens et composants, contrastes mesurés en direct dans le thème courant.
- **Vérification automatique** : [`src/styles/tokens.test.ts`](../src/styles/tokens.test.ts) lit
  `globals.css` et vérifie les contrastes WCAG AA des couples de tokens, en clair et en sombre
  (57 contrôles).
- **Captures de référence** : [`docs/screenshots/`](screenshots) (`npm run screenshots`).

## 1. Architecture des tokens

Trois niveaux, du plus brut au plus utilisé :

| Niveau              | Où                                | Exemple                                    | Qui l'utilise                               |
| ------------------- | --------------------------------- | ------------------------------------------ | ------------------------------------------- |
| Primitives          | `@theme static`                   | `--color-brand-600`, `--color-neutral-200` | rôles sémantiques, illustrations, `/design` |
| Rôles sémantiques   | `:root` (clair), `.dark` (sombre) | `--primary`, `--muted-foreground`          | redéfinis par thème                         |
| Exposition Tailwind | `@theme inline`                   | `bg-primary`, `text-muted-foreground`      | **tous les composants**                     |

La palette par défaut de Tailwind est désactivée (`--color-*: initial`) : un composant ne peut pas
employer `text-red-500` ni une couleur brute (ESLint refuse aussi `bg-[#…]`). Le mode sombre n'est
pas une inversion : chaque rôle y est choisi et vérifié pour le fond sombre.

## 2. Couleurs

### Orange GoStation (flamme → braise)

Contraste avec du texte blanc (◻) et presque noir `neutral-950` (◼).

| Nuance  | OKLCH                   | Hex       | ◻        | ◼     |
| ------- | ----------------------- | --------- | -------- | ----- |
| 50      | `oklch(0.982 0.016 74)` | `#fff8ee` | 1.06     | 18.75 |
| 100     | `oklch(0.955 0.038 75)` | `#ffedd5` | 1.14     | 17.29 |
| 200     | `oklch(0.905 0.077 70)` | `#ffd7a8` | 1.35     | 14.69 |
| 300     | `oklch(0.84 0.128 64)`  | `#ffb86d` | 1.70     | 11.62 |
| 400     | `oklch(0.765 0.17 54)`  | `#ff9036` | 2.26     | 8.77  |
| 500     | `oklch(0.7 0.195 46)`   | `#fc6d07` | 2.87     | 6.90  |
| **600** | `oklch(0.58 0.19 39)`   | `#d14200` | **4.66** | 4.25  |
| 700     | `oklch(0.51 0.168 37)`  | `#b13505` | 6.23     | 3.18  |
| 800     | `oklch(0.445 0.14 36)`  | `#912d0f` | 8.13     | 2.44  |
| 900     | `oklch(0.39 0.112 37)`  | `#752912` | 10.10    | 1.96  |
| 950     | `oklch(0.26 0.075 36)`  | `#411307` | 15.92    | 1.24  |

600 a été accordé pour porter du texte blanc (≥ 4,5:1) : c'est le bouton primaire en clair. En
sombre, le primaire est 500 avec un texte 950 (6,9:1). L'orange en texte (liens, « Ouvrir ») est
`--brand-text` : 700 en clair, 400 en sombre.

### Neutres (teinte 55–75, chroma ≤ 0,009)

| Nuance | OKLCH                   | Hex       | ◻     | ◼     |
| ------ | ----------------------- | --------- | ----- | ----- |
| 50     | `oklch(0.985 0.002 75)` | `#fbfaf9` | 1.04  | 18.96 |
| 100    | `oklch(0.967 0.003 75)` | `#f5f4f2` | 1.10  | 17.99 |
| 200    | `oklch(0.923 0.004 70)` | `#e7e5e3` | 1.26  | 15.76 |
| 300    | `oklch(0.869 0.006 65)` | `#d7d3d0` | 1.49  | 13.31 |
| 400    | `oklch(0.708 0.008 60)` | `#a5a09c` | 2.60  | 7.62  |
| 500    | `oklch(0.556 0.009 58)` | `#78726e` | 4.74  | 4.17  |
| 600    | `oklch(0.47 0.009 56)`  | `#5f5a56` | 6.84  | 2.89  |
| 700    | `oklch(0.371 0.008 55)` | `#433f3c` | 10.41 | 1.90  |
| 800    | `oklch(0.269 0.006 55)` | `#292523` | 15.13 | 1.31  |
| 900    | `oklch(0.205 0.005 55)` | `#191715` | 17.93 | 1.10  |
| 950    | `oklch(0.145 0.004 55)` | `#0b0a09` | 19.80 | 1.00  |

### Rôles sémantiques

| Rôle                                         | Clair                  | Sombre                    | Usage                                      |
| -------------------------------------------- | ---------------------- | ------------------------- | ------------------------------------------ |
| `background` / `foreground`                  | neutral-50 / 950       | neutral-950 / 50          | fond de page, texte courant                |
| `card`, `surface`                            | blanc                  | `oklch(0.185 0.005 55)`   | cartes, champs                             |
| `popover`                                    | blanc                  | `oklch(0.215 0.006 55)`   | menus, info-bulles, dialogues              |
| `primary` / `primary-foreground`             | brand-600 / blanc      | brand-500 / brand-950     | action principale                          |
| `primary-hover`                              | brand-700              | brand-400                 | survol du primaire                         |
| `primary-subtle` (+ `-foreground`)           | brand-50 / 800         | orange sombre / brand-200 | badges de marque, élément actif            |
| `brand-text`                                 | brand-700              | brand-400                 | orange porté par du texte                  |
| `muted` / `muted-foreground`                 | neutral-100 / 600      | `0.235` / neutral-400     | textes secondaires (≥ 4,5:1)               |
| `accent`                                     | neutral-100            | `0.255`                   | survol des éléments neutres                |
| `border` / `border-strong`                   | neutral-200 / 300      | `0.285` / `0.35`          | séparateurs, contours de boutons           |
| `input`                                      | `oklch(0.64 0.008 60)` | `oklch(0.5 0.008 55)`     | **contour des champs ≥ 3:1** (WCAG 1.4.11) |
| `ring`                                       | brand-600              | brand-400                 | anneau de focus (≥ 3:1)                    |
| `destructive`                                | rouge 600 + blanc      | rouge 400 + texte foncé   | suppression, erreurs                       |
| `success` · `warning` · `info` (+ `-subtle`) | vert, ambre, bleu      | idem, pas de sombre       | statuts, toujours avec icône et libellé    |
| `sidebar*`                                   | blanc, neutral-700     | `0.165`, neutral-300      | barre latérale                             |

Couples vérifiés par le test : texte ≥ 4,5:1 (fond, carte, popover, primaire et son survol, teintés
de chaque statut composés sur la carte, atténué sur fond/carte/muted, barre latérale) ; anneau et
contour de champ ≥ 3:1. Le test a fait corriger deux défauts à la conception : contour de champ
(1,4:1 → 3,1:1) et texte blanc sur rouge en sombre (3,8:1).

## 3. Données (graphiques)

Composants Chart de shadcn/ui (Recharts), règles `dataviz` :

- **Séries catégorielles** (`--chart-1` … `--chart-8`) : palette validée (CVD ΔE ≥ 8 entre voisins,
  plancher de vision normale ≥ 15) en clair et en sombre. **Ordre fixe** : la couleur suit le
  produit (ordre des identifiants), jamais son rang ni la période. Au-delà de 8, pas de couleur
  inventée.
- Trois séries claires sont sous 3:1 sur fond clair : **vue tableau** obligatoire (bascule
  Graphique / Tableau sur chaque carte) et tableau `sr-only` toujours présent.
- **Statuts** (`--status-good|warning|critical`) réservés à la fraîcheur (à jour, à rafraîchir,
  exclues) : jamais pour une série, toujours avec icône et libellé.
- Marques fines : barres ≤ 28 px, extrémité arrondie 4 px, écart de 1 px entre segments empilés,
  lignes 2 px, aires à 10 %, grille horizontale discrète, un seul axe Y, graduations compactes
  (« 4,5 k », « 18 k »).
- Légende dès deux séries ; texte dans les couleurs de texte (jamais la couleur de la série).
- Tranche en cours (jour ou heure incomplets) : barre plus claire + note ; exclue des sparklines.
- Info-bulle au survol et au clavier (couche d'accessibilité Recharts) ; résumé textuel lu avant le
  graphique.

## 4. Typographie

Geist (interface) et Geist Mono (codes, identifiants H3, secrets), variables, auto-hébergées
(`@fontsource-variable`, aucune requête vers un CDN). Chiffres tabulaires (`tabular-nums`) pour
toute comparaison.

| Classe      | Taille / interligne | Usage                                    |
| ----------- | ------------------- | ---------------------------------------- |
| `text-3xl`  | 30 px               | accroche du panneau de marque            |
| `text-2xl`  | 24 px               | valeurs d'indicateurs                    |
| `text-xl`   | 20 px               | titre de page (h1)                       |
| `text-base` | 16 px               | champs sur mobile, titres d'état vide    |
| `text-sm`   | 14 / 20 px          | **interface** (corps, boutons, tableaux) |
| `text-xs`   | 13 / 18 px          | descriptions, en-têtes de tableau        |
| `text-2xs`  | 12 / 16 px          | légendes, badges — **minimum**           |

## 5. Espacements, rayons, élévations

- Grille de 4 px (`--spacing`). Cartes : 20 px de marge interne ; 12 px entre cartes d'une grille,
  24 px entre sections ; page : 16 / 24 / 32 px selon la largeur.
- Rayons : `xs` 4 · `sm` 6 · `md` 8 (boutons, champs) · `lg` 10 · `xl` 14 (cartes) · `2xl` 18.
- Élévations (`shadow-elevation-*`) : **0** à plat · **1** cartes, boutons contour · **2** menus,
  info-bulles, toasts · **3** dialogues, palette ⌘K. En sombre, l'élévation passe aussi par une
  surface plus claire (`card` < `popover`) et une ombre plus dense.

## 6. Mouvement

| Token             | Valeur                           | Usage                      |
| ----------------- | -------------------------------- | -------------------------- |
| `--duration-fast` | 120 ms                           | survol, appui              |
| `--duration-base` | 200 ms                           | fondus, changements d'état |
| `--duration-slow` | 320 ms                           | entrées de blocs           |
| `--ease-out`      | `cubic-bezier(0.23, 1, 0.32, 1)` | entrées                    |
| `--ease-in`       | `cubic-bezier(0.4, 0, 1, 1)`     | sorties (plus courtes)     |

**Transform et opacité uniquement** (60 fps sur le compositeur). La barre latérale ne s'anime jamais
en largeur : le panneau glisse, son contenu glisse en sens inverse, et le contenu principal suit en
FLIP. Les blocs du tableau de bord apparaissent en fondu décalé (`animate-step-in`).
`prefers-reduced-motion` coupe les déplacements (durées ramenées à ~0).

## 7. États

| État          | Règle                                                                                                                 |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| Survol        | changement de fond ou de bordure en 120 ms ; jamais l'unique indice d'une action                                      |
| Focus visible | anneau `ring` 2 px décalé de 2 px (≥ 3:1), sur tout élément interactif                                                |
| Désactivé     | opacité 50 %, curseur par défaut, pas d'événements                                                                    |
| Chargement    | squelettes aux dimensions du contenu final (CLS 0), reflet en transform ; bouton `loading` (indicateur + `aria-busy`) |
| Vide          | `EmptyState` : illustration, titre, explication, action facultative                                                   |
| Erreur        | `ErrorState` : message français issu du code stable, référence (`requestId`), « Réessayer »                           |

Illustrations (SVG en ligne, aux tokens, décoratives) : graphique vide, aucune pénurie, à venir,
erreur, introuvable.

## 8. Composants

Primitives shadcn/ui (Radix) harmonisées : `button` (variantes, tailles, `loading`), `input`,
`badge` (marque, succès, alerte, danger, info), `alert` (mêmes statuts), `card`, `table`, `dialog`,
`sheet`, `dropdown-menu`, `tooltip`, `toggle-group` (variante `segmented`), `checkbox`, `input-otp`,
`calendar`, `popover`, `command`, `chart`, `sonner`, `skeleton`, `breadcrumb`.

Blocs inspirés du catalogue 21st.dev (code récupéré via le MCP, puis réécrit aux tokens) :

| Bloc                                     | Source 21st.dev                                  | Adaptation                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Barre latérale                           | « Sidebar » (wensity)                            | sections, badges, pastille active qui glisse ; **repli en transform** (l'original anime la largeur), rail d'icônes avec info-bulles, tiroir sous 768 px  |
| Cartes d'indicateurs, carte de graphique | « Charts & KPI Cards » (uvain)                   | indicateur qui sait si la hausse est favorable, flèche + libellé lu (jamais la couleur seule), résumé et tableau pour lecteurs d'écran, sur shadcn Chart |
| État vide                                | « Empty » (cnippet)                              | composition média / titre / description / action, illustrations maison                                                                                   |
| Palette ⌘K                               | « Command Menu » (uvain, inspiration)            | shadcn `command` (cmdk), chargée au premier usage                                                                                                        |
| Mise en place 2FA                        | « Two-Factor Authentication Card » (inspiration) | QR généré localement, clé manuelle groupée par 4, étapes Scanner / Vérifier / Sauvegarder                                                                |

## 9. Accessibilité (WCAG 2.2 AA)

- Navigation clavier complète, lien d'évitement « Aller au contenu », focus visible partout.
- Libellés visibles sur tous les champs, aides et erreurs reliées par `aria-describedby`, erreurs
  annoncées (`role="alert"`), focus déplacé sur le premier champ de chaque étape.
- Nom accessible qui contient le texte visible (période « 7 j · 7 derniers jours », avatar).
- Statuts jamais portés par la couleur seule ; graphiques doublés d'un tableau.
- Contrastes vérifiés par test ; Lighthouse accessibilité 100 (connexion et tableau de bord).

## 10. Performance

- JS initial **137 Ko gzip** (budget 200 Ko, `npm run check:bundle`) : routes découpées, MapLibre,
  calendrier, palette ⌘K, QR code, graphiques, toasts et schéma du tableau de bord chargés à la
  demande ; `zod/mini` ; formateurs `Intl` créés au premier usage.
- Tableau de bord : rendu différé (`useDeferredValue`), sections montées une par une, graphiques
  rendus une seule fois à leur taille mesurée.
- Lighthouse desktop (build de production) : connexion 97–98, tableau de bord 97, accessibilité et
  bonnes pratiques 100.
