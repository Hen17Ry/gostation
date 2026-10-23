# Landing gostation.bj — storyboard

Site public de GoStation (`Site/`, Astro). Ce document fixe l'histoire, le texte et la mécanique de
chaque scène **avant** leur code : déclencheurs ScrollTrigger, version mobile, version légère (sans
3D) et version réduite (`prefers-reduced-motion`). Toute scène livrée doit correspondre à sa fiche ;
une modification de l'histoire passe d'abord par ce fichier.

## 0. Référence : ce qu'on retient du site du Tesla Roadster

Capture de 28 s (écran filmé, `~/Vidéos/Captures vidéo/Capture vidéo du 2026-10-23 13-54-20.webm`,
hors dépôt : contenu d'un tiers). Images clés extraites avec ffmpeg à 1,5 image/s.

| Temps | Ce qu'on voit | Mécanique |
| --- | --- | --- |
| 0–3 s | Lignes de construction (piste ovale, horizon), puis la voiture de dos, **au trait** | Tracé progressif des contours (dash offset) ; les lignes de construction d'abord, l'objet ensuite |
| 3 s | Le croquis devient un **rendu 3D dans la même pose** ; un bandeau rouge monte du bas | Fondu croquis → 3D sans changement de cadrage : la continuité vend l'effet |
| 3–8 s | Voiture au repos (aileron animé) posée **sur** le bandeau ; texte condensé défilant « 0-60 MPH 1.9 S · TOP SPEED 250+ MPH » | Le bandeau sert de sol ; défilement lent et continu, chiffres clés en capitales condensées |
| 8–10 s | Au défilement, la voiture pivote de profil et démarre ; le texte du bandeau se **floute horizontalement** | Vitesse de défilement → flou de mouvement du bandeau |
| 10–12 s | La voiture traverse l'écran en sautant par-dessus d'autres véhicules | L'objet quitte son socle et traverse le cadre |
| 12–15 s | Vue de dessus : la voiture pivote nez en haut ; un **panneau rouge** glisse depuis la droite et couvre l'écran | Couleur qui envahit la page par un volet |
| 15–17 s | Le panneau se resserre en **barre verticale**, qui devient la hampe du premier « T » | Le volet se transforme en lettre |
| 17–20 s | Les lettres apparaissent **une à une** | Révélation lettre par lettre, chaque lettre née de la précédente |
| 20–22 s | Une fusée traverse le logo, sa fumée remplit l'écran | Transition par matière (fumée) plutôt que par coupe |
| 22–25 s | Fumée → nuages → **la Terre vue de l'espace**, logos au centre | Zoom arrière continu, final cinématique |
| 25 s | Retour au croquis | La boucle se referme |

**Principe retenu : chaque transition réutilise l'objet précédent** (croquis → 3D, bandeau → sol,
volet → lettre, fumée → nuages → Terre). Un seul sujet par écran, très peu de texte mais très grand,
la couleur employée comme un volet. Rien n'est repris de Tesla : ni visuel, ni forme, ni logo, ni
typographie ; aucun logo de marque tierce, aucune compagnie pétrolière.

Notre fil : **croquis de bouteille → bouteille 3D → le bandeau orange inonde l'écran → la nuit sur
la ville → la bouteille devient le point qui erre → le téléphone → l'onde radar → l'itinéraire → le
téléphone pivote (gérant) → le réseau d'une compagnie → le volet orange devient le « T » de
GOSTATION → zoom arrière jusqu'au Bénin vu de l'espace.**

## 1. Règles communes

### Calques (du fond vers l'avant)

1. **Fond fixe** (`Backdrop.astro`, plein écran) : couleurs de scène (orange, nuit, braise, espace,
   fondus entre elles), Cotonou de nuit, téléphone en HTML (mode léger), l'espace. Animé en
   transform et opacité seulement.
2. **Canevas WebGL fixe** (un seul, transparent, `pointer-events: none`) : bouteille, téléphone,
   globe. Mode complet uniquement.
3. **Contenu HTML** qui défile : tout le texte de l'histoire, les boutons, le bandeau, les
   étiquettes posées sur la carte.

Le texte reste toujours au-dessus de la 3D : lisible, sélectionnable, traduit par le navigateur.

**Une scène par élément.** Les objets partagés (couleurs du fond, ville, téléphone, Terre) sont
pilotés par des « poses » : chaque scène anime la sienne (entrée, cadrage, pivot, sortie), l'objet
affiché est leur composition (`lib/motion/rigs.ts`, `backdrop.ts`). Aucune scène n'anime un élément
qu'une autre anime : on peut défiler dans les deux sens ou sauter d'un lien, l'état reste juste.

**Barre d'en-tête** : sa teinte suit ce qu'elle recouvre (`data-theme` des sections : verre clair
ou sombre selon le système sur « page », verre sombre sur la nuit, barre presque opaque sur
l'orange ; le bandeau qui envahit l'écran porte lui-même `brand`).

### Trois modes, une seule histoire

| Mode | Quand | Ce qui change |
| --- | --- | --- |
| **Complet** | Par défaut | 3D (Three.js chargé à la demande), épinglages, scrub, Lenis |
| **Léger** | `deviceMemory ≤ 3`, peu de cœurs (≤ 4 sur un écran tactile, ≤ 2 sinon), `saveData`, WebGL absent, ou FPS mesurés < 40 pendant 1 s après l'ouverture ; bascule possible à la main (« Version légère », pied de page, mémorisée) | Même chorégraphie avec des illustrations SVG 2D à la place de la 3D ; Three.js n'est jamais téléchargé |
| **Réduit** | `prefers-reduced-motion: reduce` | Ni épinglage, ni scrub, ni intro, ni défilement automatique : chaque scène dans son état final, lue comme une page |

Sans JavaScript, la page est la version réduite (état final en CSS). `?mode=full|lite|reduced`
force un mode (tests, vidéos).

### Mouvement

- Transform, opacité et uniforms WebGL uniquement. Le tracé au trait (DrawSVG) ne touche que des
  `stroke-dashoffset` de quelques chemins, pendant l'intro.
- Lenis (molette lissée sur ordinateur ; défilement natif au doigt) piloté par le ticker de GSAP,
  synchronisé avec ScrollTrigger : une seule boucle `requestAnimationFrame`.
- WebGL rendu **à la demande** (une image seulement quand une valeur change), pixel ratio plafonné à
  2 (1,5 sur mobile), en pause hors écran et onglet caché.
- Tout mouvement automatique de plus de 5 s (rotation de la bouteille, défilement du bandeau) a un
  bouton **Pause** (WCAG 2.2.2), visible dans la scène.
- `ScrollTrigger.config({ ignoreMobileResize: true })` et hauteurs en `svh`/`lvh` : la barre
  d'adresse mobile ne relance pas les calculs.

### Typographie et couleurs

- Titres : **Bricolage Grotesque** ExtraBold (axe de chasse 75 → 100 : condensée dans le bandeau,
  normale dans les titres), auto-hébergée, sous-ensemble latin + français (35 Ko). Texte : **Geist**
  (celle de l'admin), 18 Ko.
- Tokens générés depuis `Web/src/styles/globals.css` (`npm run gen:tokens`) : orange 50 → 950,
  neutres chauds, rôles clair et sombre. Bandeau : orange 500, texte 950 (6,9:1).
- La scène d'ouverture suit le thème du système (papier clair ou nuit chaude) ; les scènes 2 à 7
  sont de nuit dans les deux thèmes.

### Longueur

Environ 20 hauteurs d'écran sur ordinateur, 16 sur mobile (épinglages raccourcis de 20 %).

## 2. Scènes

Notation des déclencheurs : `start` / `end` au format ScrollTrigger, `pin`, `scrub` (secondes de
lissage). « Timeline » = animation liée au défilement, de 0 (début de l'épinglage) à 1 (fin).

### Scène 1 — Ouverture

**Texte**

- H1 : « Le gaz, l'essence, le gasoil. » / « **Là où il y en a.** »
- Chapeau : « GoStation vous montre la station la plus proche qui a votre produit en stock, puis
  vous y guide. »
- Actions : « Télécharger l'app » (APK du build preview, `PUBLIC_APK_URL`) et « Comment ça marche »
  (ancre vers la scène 2). Mention : « Android · gratuit ».
- Bandeau défilant : `GAZ 5 KG · 10 KG · 25 KG · ESSENCE · GASOIL · EN STOCK PRÈS DE VOUS ·`
  (lu une seule fois par les lecteurs d'écran : « Gaz 5 kg, 10 kg et 25 kg, essence, gasoil : en
  stock près de vous. »). Chaque jeu finit par son séparateur ; la boucle décale exactement du pas
  mesuré entre deux jeux, après le chargement des polices et à chaque changement de taille (test
  visuel de la jointure : `e2e/seam.spec.ts`). Sous le texte, sur un filet : « Faites défiler » à
  gauche, Pause à droite ; le bandeau est compact, sans vide orange.
- Bouteille : plus grande que le titre n'est large, ombre de contact sur le bandeau, lumière de
  contour, peinture au vernis usé (rugosité variable, éclats discrets), étiquette « GAZ · 10 KG ».

**Ce qui bouge (au chargement, ~2,8 s, avant tout défilement)**

| t | Mouvement |
| --- | --- |
| 0 → 1,5 s | Le croquis se trace (DrawSVG) : axe de révolution et ligne de sol d'abord, puis la silhouette de la bouteille (pied, corps, soudure, collerette ajourée, robinet), enfin la cote de hauteur et l'étiquette « 10 kg » |
| 0 s | Le titre, le chapeau et les actions sont là dès le premier rendu (le titre est le LCP) : pas d'entrée animée |
| 0,7 → 1,3 s | Le bandeau orange monte du bas ; le texte se met à défiler (≈ 40 px/s) |
| 1,5 → 2,7 s | **Le croquis devient 3D** : la bouteille se « remplit » de bas en haut (balayage d'un uniform, liseré lumineux à la coupe) exactement dans la pose du croquis ; les traits sous le liseré s'effacent |
| 2,7 s → | La bouteille tourne doucement (un tour en 16 s) ; la plaque « 10 KG », la collerette et le robinet font lire la rotation |

**Défilement** — `trigger: #ouverture`, `start: 'top top'`, `end: '+=100%'` (mobile `+=80%`),
`pin: true`, `scrub: 0.8`. Passage court : chaque instant montre quelque chose.

| Timeline | Mouvement |
| --- | --- |
| 0 → 0,3 | Titre, chapeau et actions montent de 64 px et s'effacent ; la bouteille pivote de 120° et monte |
| tout le long | Le bandeau accélère avec la vitesse de défilement (dans le sens du défilement) et s'incline (`skewX` ±8°) : notre « flou de vitesse » en transform |
| 0,42 → 0,92 | **Le bandeau inonde l'écran** : son fond s'étire vers le haut (`scaleY`, origine en bas) ; son texte monte et s'efface ; la bouteille s'enfonce et rapetisse ; l'ombre de contact s'efface |
| 0,92 → 1 | Sous le bandeau qui couvre tout, le décor fixe prend le même orange : la section peut partir, l'orange reste, et le titre de la scène 2 arrive dessus |

**Mobile** — colonne : titre en haut (3 lignes), bouteille au centre (36 svh), bandeau de 22 svh
(texte à 15 vw) ; actions sous le titre, bouton de 48 px. Épinglage `+=100%`.

**Léger** — même tracé au trait ; le remplissage est un rectangle de découpe SVG qui monte
(transform), sur une bouteille 2D ombrée (dégradés) ; au repos, légère flottaison (±4 px) au lieu
de la rotation.

**Réduit** — bouteille 2D pleine, titre et actions visibles, bandeau immobile sur une ligne ;
aucun épinglage.

### Scène 2 — Le problème

**Texte** (kicker « Le problème », qui apparaît avec la nuit)

- H2 : « Mais quand la bouteille est vide… » : il monte sur l'orange laissé par l'ouverture (texte
  sombre), puis passe en clair quand la nuit tombe (deux copies superposées en fondu).
- Étapes, une par palier : « Première station : rupture. » · « Deuxième station : rupture. » ·
  « On tourne. On perd du temps. » · « Et on finit par acheter au hasard. »

**Ce qui bouge** — `trigger: #probleme`, `start: 'top top'`, `end: '+=260%'`, `pin: true`,
`scrub: 1`.

| Timeline | Mouvement |
| --- | --- |
| 0 → 0,15 | L'orange s'efface en fondu sur la nuit ; Cotonou apparaît : **la vraie ville**, dessinée au build depuis OpenStreetMap (grands axes, chenal, lac Nokoué, océan, avec la palette sombre de la carte de l'app), lampadaires en points ambrés, quelques quartiers nommés. Stations fictives posées sur les routes |
| 0,15 → 0,86 | Un trajet erre sur les vraies routes (OSRM ; DrawSVG scrubbé, tirets orange 400) ; un petit repère (la bouteille vide) le suit (MotionPath) |
| à chaque station atteinte (position calculée sur le tracé) | Le picto de la station se barre (deux traits tracés), l'étiquette « Rupture » se pose (échelle 1,4 → 1) ; l'étape de texte correspondante entre |
| 0,86 → 1 | Arrivée « Au hasard » (un point d'interrogation) : « Et on finit par acheter au hasard. » |

**Mobile** — même carte recadrée en portrait (`preserveAspectRatio="xMidYMid slice"`, ville
centrée sur la lagune) ; les étapes en bas, dans une carte translucide. `+=200%`.

**Léger** — identique (la scène est déjà en 2D) ; le repère est un SVG.

**Réduit** — carte fixe : le trajet complet tracé, trois stations barrées « Rupture » ; les quatre
étapes en liste.

### Scène 3 — La solution

**Texte** (kicker « La solution »)

- H2 : « Choisissez. GoStation cherche. »
- Étapes : « Gaz » → « 10 kg » → « La recherche s'élargit pas à pas : 500 m, 1 km, 2 km… » →
  « Seules s'allument les stations **ouvertes**, avec du **stock** mis à jour. »

**Ce qui bouge** — `trigger: #solution`, `start: 'top top'`, `end: '+=320%'`, `pin: true`,
`scrub: 1`. La carte de la scène 2 reste en fond.

| Timeline | Mouvement |
| --- | --- |
| 0 → 0,2 | **Un téléphone 3D entre** par la droite en pivotant (`rotation.y` −35° → −12°) ; son écran (texture dessinée en Canvas 2D, rafraîchie seulement aux changements d'état) montre « Que cherchez-vous ? » et trois choix |
| 0,2 → 0,3 | Toucher sur « Gaz » (onde de toucher, puce orange), puis les tailles apparaissent ; toucher sur « 10 kg » |
| 0,3 → 0,8 | Sur la carte, depuis la position de l'utilisateur, **l'onde radar s'élargit par paliers** comme le vrai algorithme (500 m, 1 km, 2 km) : à chaque palier, l'anneau s'arrête, son libellé s'affiche, les stations du disque se révèlent. Celles en rupture ou fermées restent grises ; **seules les stations en stock s'allument** (halo orange). On s'arrête au premier palier qui en compte trois. Le téléphone montre la même onde sur la carte claire de l'app |
| 0,8 → 1 | L'écran du téléphone affiche la liste des résultats, classés par temps de trajet OSRM (« Station démo · Étoile rouge », 1,7 km, 2 min, 9 bouteilles, « mis à jour il y a 12 min ») ; les rangs 1, 2, 3 se posent sur la carte |

**Mobile** — carte en fond ; téléphone dans la moitié basse (55 % de largeur), texte en haut.
`+=260%`.

**Léger** — téléphone en HTML/CSS (cadre, écran en SVG) avec perspective CSS ; même onde.

**Réduit** — téléphone (image fixe) sur les résultats, anneaux dessinés aux quatre paliers, stations
allumées ; étapes en liste.

### Scène 4 — L'itinéraire

**Texte** (kicker « L'itinéraire »)

- H2 : « Le trajet le plus rapide, sur les vraies routes. »
- « Étapes en français, pas à pas. » · badge « Mis à jour il y a 12 min » · arrivée : « Gaz 10 kg :
  en stock. Vous y êtes. »

**Ce qui bouge** — `trigger: #itineraire`, `start: 'top top'`, `end: '+=260%'`, `pin: true`,
`scrub: 1`.

| Timeline | Mouvement |
| --- | --- |
| 0 → 0,15 | La carte zoome vers la station choisie (groupe SVG, échelle 1 → 2,2) ; le téléphone glisse sur le côté |
| 0,14 → 0,84 | **Le tracé se dessine** (le vrai trajet OSRM : rue de Ouidah, avenue de la République, place de l'Étoile Rouge) et un **zémidjan** (moto vue de dessus) le suit au rythme du défilement (MotionPath, orientation automatique) ; l'écran du téléphone affiche l'étape en cours et la distance qui décroît |
| 0,85 → 1 | Arrivée : l'épingle de la station pulse une fois, le badge « Mis à jour il y a 12 min » se pose à côté |

**Mobile** — même chose en portrait ; le téléphone passe en bas de l'écran, réduit. `+=200%`.
**Léger** — identique (2D), téléphone HTML. **Réduit** — tracé complet, moto à l'arrivée, badge.

### Scène 5 — Le gérant

**Texte** (kicker « Pour les gérants »)

- H2 : « Vos stocks à jour en un geste. »
- « + et − pour les bouteilles, litres pour les carburants. » · « Rien n'a changé ? Un bouton
  suffit. » · « Un rappel toutes les 4 h, pendant vos horaires d'ouverture. » · « Gratuit pour les
  stations. »
- Action : « Inscrire ma station » (télécharger l'app : l'inscription se fait dans l'espace gérant).

**Ce qui bouge** — `trigger: #gerants`, `start: 'top top'`, `end: '+=240%'`, `pin: true`,
`scrub: 1`.

| Timeline | Mouvement |
| --- | --- |
| 0 → 0,24 | **Le téléphone fait un tour complet** sur Y (on voit son dos et le logo à mi-course, comme la voiture de la référence) et revient sur l'écran Stocks du gérant ; la ville s'éteint, fond braise |
| 0,22 → 0,4 | Le rappel des 4 h descend : « Vos stocks sont-ils à jour ? » avec « Mettre à jour » et « Rien n'a changé » (les vraies actions) ; toucher sur « Mettre à jour » |
| 0,44 → 0,5 | Toucher sur « + » de « Gaz 10 kg » : 13 → 14 |
| 0,6 → 0,66 | Toucher sur « **Rien n'a changé** » : « Stocks confirmés · à l'instant » |
| 0,78 → 1 | « Gratuit pour les stations. » et « Inscrire ma station » |

**Mobile** — téléphone centré, texte au-dessus puis en dessous. `+=200%`. **Léger** — téléphone
HTML, mêmes états. **Réduit** — écran Stocks fixe, les quatre points en liste.

### Scène 6 — Pour les compagnies

**Texte** (kicker « Pour les compagnies »)

- H2 : « Tout votre réseau, d'un coup d'œil. »
- « Sur demande, un panneau dédié : les stocks de vos stations en temps réel, les ruptures, les
  alertes. » · « Vos données ne sont jamais partagées avec une autre compagnie. »
- Actions : « Nous contacter » (`mailto:` vers `PUBLIC_CONTACT_EMAIL`, contact@gostation.bj) et
  WhatsApp (`wa.me`, `PUBLIC_WHATSAPP_NUMBER` ; bouton masqué tant qu'aucun numéro n'est configuré).
  Aucun formulaire : le site ne collecte rien.

**Ce qui bouge** — pas d'épinglage. À l'arrivée de la section (`'top bottom'` → `'top 30%'`,
scrub), la nuit et la braise s'effacent en fondu vers le fond de page, le téléphone s'en va vers le
haut ; puis apparitions au défilement (`'top 78%'`, `toggleActions: 'play none none reverse'`).

- Carte du sud du Bénin (OpenStreetMap, de Ouidah à Porto-Novo, lac Nokoué) : les stations d'un
  réseau fictif s'allument une à une, couleur et pictogramme selon le stock (en stock, stock bas,
  rupture : jamais la couleur seule), légende.
- Un aperçu de tableau de bord monte depuis le bas (carte HTML) : tuiles « Stations à jour »,
  « Ruptures », « Alertes », petit graphique ; étiquette « Aperçu · données d'exemple ».

**Mobile** — carte puis aperçu empilés. **Léger** — identique. **Réduit** — affichés sans animation.

### Scène 7 — Final

**Texte**

- Titre (H2) : « GoStation », affiché GOSTATION en capitales ; sous-titre « Là où il y en a. »
- Actions : « Télécharger l'app » + **QR code** (« Scannez pour installer sur Android »),
  « Nous contacter ».

**Ce qui bouge** — `trigger: #final`, `start: 'top top'`, `end: '+=260%'`, `pin: true`,
`scrub: 1`.

| Timeline | Mouvement |
| --- | --- |
| 0 → 0,15 | **Volet orange** depuis la droite (`scaleX`, origine à droite) qui couvre l'écran |
| 0,13 → 0,27 | Le volet se resserre en barre verticale (`scaleX`, `scaleY`) qui atterrit sur la hampe du premier « T » (mesurée en positions de mise en page) |
| 0,27 → 0,5 | **Révélation lettre par lettre** : la barre se fond dans le T ; puis S, A, O, T, G, I, O, N montent de leurs masques, en alternance de part et d'autre ; le slogan suit |
| 0,56 → 0,94 | **Zoom arrière** : l'espace en fondu, le mot monte et rapetisse ; le sud du Bénin (fondu de bord) rapetisse, puis la Terre de nuit : terres en points, le Bénin en orange, halo d'atmosphère (globe 3D en mode complet, image 2D en léger, même disque) |
| 0,9 → 1 | Les actions et le QR code se posent en bas, sous la Terre |

**Mobile** — mot sur toute la largeur (`wdth` 75), QR code masqué (on est déjà sur le téléphone :
bouton seul). `+=200%`. **Léger** — contour du Bénin et limbe de la Terre en SVG. **Réduit** — mot
complet, Bénin fixe, actions et QR code.

### Scène 8 — Questions et pied de page

- **FAQ** (vrais faits seulement) : « Faut-il un compte ? » (non pour chercher, oui pour signaler,
  les favoris et les alertes) · « Ma position est-elle enregistrée ? » (jamais : utilisée le temps de
  la recherche puis oubliée) · « Les stocks sont-ils fiables ? » (saisis par les gérants, l'âge est
  affiché, au-delà de 24 h la station disparaît de la recherche, signalements) · « Comment inscrire
  ma station ? » · « Et sur iPhone ? » (Android d'abord).
- **Pied de page** : Politique de confidentialité (`/politique-confidentialite`), CGU (`/cgu`),
  Suppression de compte (`/suppression-compte`), Contact, « Version légère ». Ces trois adresses ne
  changent pas (Google OAuth et Google Play pointent dessus).
- À l'arrivée des questions, l'espace et la Terre s'effacent en fondu vers le fond de page. Pas
  d'épinglage.
- Les pages légales sont rendues par le site (même source `docs/legal/*.md`, même analyseur que
  l'app), en page de texte sans animation ; adresses inchangées (et leurs variantes `.html`).

## 3. Budgets et vérifications

| Mesure | Cible |
| --- | --- |
| JS initial | < 150 Ko gzip (`npm run check:bundle`) : GSAP, ScrollTrigger, DrawSVG, Lenis et les scènes 2D ; Three.js et MorphSVG à la demande |
| LCP | < 2,5 s en 4G (le H1 en HTML, police d'affichage préchargée) |
| Lighthouse mobile | ≥ 85 performance, ≥ 95 accessibilité, SEO et bonnes pratiques (médiane de 3 passes) |
| Fluidité | 60 fps au défilement : ordinateur, Galaxy S10, Huawei Y8p (mode léger attendu) |
| CSP | sans `unsafe-inline` : scripts et styles en ligne autorisés par empreinte (`dist/csp.txt`) ; les E2E échouent sur toute violation |

**Démarrage** (ce qui tient le fil principal court) :

- Le moteur démarre après le premier rendu complet ; le CSS d'avant le script donne l'état de
  départ (croquis, bouteille et téléphone masqués, bandeau sous l'écran).
- Sans processeur graphique (rendu WebGL logiciel), version légère d'emblée : la 3D bloquerait le
  fil principal (`lib/motion/gpu.ts`).
- Scènes 2 à 8 créées d'un seul tenant, suivies d'un seul `ScrollTrigger.refresh()` ; pas de
  rafraîchissement au DOMContentLoaded ni au load. Les timelines ne sont invalidées que si la
  taille de la fenêtre a changé (`invalidateOnResize`), jamais à chaque rafraîchissement.
- Chaque scène épinglée a son enveloppe `[data-pin]` dans la page, passée à ScrollTrigger comme
  `pinSpacer` : l'épinglage ne déplace jamais la scène dans le DOM (sans quoi Chrome oublie le
  premier rendu du titre et repousse le LCP, et chaque rafraîchissement recrée le sous-arbre).
- Déclencheurs portés par des timelines (mesure reportée au rafraîchissement unique) ; décors
  recomposés à chaque image écrits directement (`lib/motion/style.ts`), sans `gsap.set`.

**Mesures** (`npm run lighthouse` sur le build de production servi par `scripts/preview.mjs`,
compressé comme Caddy ; médiane de 3 passes, 2026-10-23) :

| | Performance | Accessibilité | Bonnes pratiques | SEO | FCP | LCP | TBT | CLS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mobile | 76 (75, 76, 78) | 95 | 100 | 100 | 1,91 s | 2,18 s | 968 ms | 0 |
| Ordinateur | 95 (95, 95, 95) | 96 | 100 | 100 | 0,44 s | 0,55 s | 189 ms | 0 |

Lighthouse tourne sans processeur graphique : il mesure le mode léger. L'écart à 85 sur mobile
vient du TBT : la création de toutes les scènes au démarrage (une tâche d'environ 0,7 s sur le
téléphone simulé). L'accessibilité (95) compte des textes de scènes pas encore atteintes, lus sur
le fond de page au lieu de leur fond de nuit ; l'audit axe scène par scène (E2E) est sans écart.
