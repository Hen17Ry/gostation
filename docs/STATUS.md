# GoStation — État des lieux

> Mis à jour le 2026-10-22 après l'étape 10D (finitions du staging : suivi des plantages de l'app, Brevo, client Google personnel pour rclone), branche `fix/staging-finish` fusionnée dans `main`. Étape 10C (staging sur le VPS Wayhost) le même jour ; version précédente : 2026-10-21 (étape 10B). Chaque affirmation vient d'une commande exécutée ou d'un fichier cité ; ce qui n'a pas été vérifié est signalé.

## 1. Résumé

- **Le staging est en ligne** sur un VPS Wayhost : `https://gostation.bj`, `https://api.gostation.bj`, `https://admin.gostation.bj`, `https://errors.gostation.bj` (TLS Let's Encrypt, `APP_ENV=staging`, bandeau Staging, noindex, 5 000 stations fictives). Runbook : `docs/DEPLOY.md` §17.
- Les étapes 10C et 10D ont révélé **huit problèmes** que la pile locale ne montrait pas. Six défauts du code sont corrigés, dont un grave dans l'app : une **boucle d'enregistrement de l'appareil push** sur Android (jusqu'à 15 requêtes par seconde) ; les autres : texte invisible dans les emails (mail-tester 6,9 → 9,3/10), palette ⌘K non conforme pendant une recherche, version des images perdue après une restauration, déploiement interrompu par une coupure SSH, plantage de test inopérant. Les plantages de l'app non reçus venaient de la **zone DNS de gostation.bj**, incohérente chez Wayhost (un serveur sert une ancienne zone) : bloquant pour la production, à faire corriger (§3, ligne DNS).
- Juridique toujours en projet : 21 « À COMPLÉTER », aucune formalité APDP. Avant la production, aussi : zone DNS, pixel de suivi de Brevo (impossible à couper par configuration), serveur de production distinct (§4). Le client Google personnel de rclone est en place.
- Bêta fermée Android : possible avec l'APK `preview` (distribution interne EAS) contre le staging.

## 2. Étapes

| # | Étape | État | Commit / branche |
|---|---|---|---|
| 0 à 7 | Fondations, socle, auth, stations, recherche, notifications, API admin, web admin | ✅ Faites | voir l'historique (`git log --merges`) |
| 8 | Mobile : parcours utilisateur, gérant, push, build | 🟡 Android fait, APK `preview` contre le staging ; iOS jamais construit | `feat/mobile`, `feat/mobile-manager`, `feat/push`, `feat/staging` |
| 9a | Données personnelles | ✅ Code fait ; textes en projet | `feat/privacy` → `7e7ae97` |
| 9b | Sécurité (10B) | ✅ Faite | `feat/hardening` |
| 9c | Tests et CI | ✅ CI verte ; perf mobile non mesurée sur la cible (D50) | `feat/hardening` |
| 9d | Déploiement (10C, 10D) | ✅ Staging en ligne (VPS Wayhost) ; production à monter ; zone DNS à faire corriger | `feat/hardening`, `feat/staging`, `fix/staging-finish` |

## 3. Vérifié le 2026-10-22 (staging)

| Vérification | Résultat |
|---|---|
| Serveur | ✅ Ubuntu 24.04 à jour, swap 4 Go, SSH par clé seulement (mot de passe refusé, root interdit), ufw (22, 80, 443 TCP, 443 UDP), fail2ban, mises à jour de sécurité automatiques ; Docker 29.9, Compose v5.6 |
| DNS | ❌ **Zone incohérente** (2026-10-22, étape 10D, `make check-dns`) : la délégation du `.bj` (dns1 et dns3.itnet-technologies.com) et les NS de la zone (serveurs `.fr`, `ns1.netim.net`) diffèrent ; `ns1.netim.net` sert une ancienne zone (série 2610200012) où `api`, `admin` et `errors` n'existent pas et où `gostation.bj` pointe vers l'ancienne IP 45.93.21.77 ; deux serveurs Wayhost (45.93.21.13, 45.93.21.18) ne répondent qu'une fois sur deux ; `www` pointe vers 45.93.21.77 partout. Les résolveurs qui tombent sur `ns1.netim.net` (celui de la box du téléphone de test) ne trouvent plus `admin` ni `errors`. SPF, DKIM, DMARC de Brevo présents |
| Déploiement | ✅ 9 services sains, seul Caddy publie des ports (Mailpit et le pilotage des E2E sur la boucle locale) ; `make deploy-staging` validé trois fois (~5 min), détaché de la session SSH |
| TLS | ✅ Let's Encrypt sur les 4 noms, expiration le 2027-01-19 ; HTTP redirigé (308) |
| `/healthz`, `/readyz` | ✅ `{"status":"ok"}` ; `ready` avec postgres, redis et osrm `ok` |
| En-têtes et CSP | ✅ HSTS, nosniff, `X-Frame-Options: DENY`, `Referrer-Policy`, CSP stricte de l'admin (origines API, GlitchTip et tuiles seulement), COOP/COEP/CORP, `X-Robots-Tag: noindex` sur les 4 sites, `robots.txt` fermé ; aucune violation de CSP dans le navigateur |
| Recherche publique | ✅ 5 stations démo à moins de 1 km de Cotonou, trajets OSRM réels (`routingApproximate: false`) |
| E2E Playwright de l'admin contre le staging | ✅ 20/20 (premier passage : 18/20, deux défauts corrigés, §3 ter) ; données de test supprimées (18 comptes, 6 stations, 8 fichiers) |
| GlitchTip | ✅ un événement de l'API, du worker et de l'admin, environnement `staging`, sans utilisateur ni IP. ✅ App mobile (étape 10D) : message de diagnostic et plantage de test (erreur JavaScript fatale, `onerror`, non gérée) reçus depuis l'APK `preview`, sans utilisateur, IP ni email, une fois `errors.gostation.bj` résolu (§3 ter) |
| Emails | ✅ inscriptions réelles envoyées par Brevo ; mail-tester **9,3/10** (6,9 avant correctif) ; réception sur Gmail : à confirmer |
| Sauvegarde | ✅ restic local (6,3 Mio, `restic check` sans erreur) et copie Google Drive identique (6 fichiers, 6 475 518 octets) ; cron quotidien à 01:30 UTC |
| Client Google personnel (10D) | ✅ projet Google Cloud dédié, autorisation `drive.file` seule, application publiée ; accès réinstallé sur le serveur ; sauvegarde `077cf3a0` copiée, copie identique au dépôt (10 fichiers, 11 224 868 octets), plus d'avertissement « client partagé » |
| Brevo, suivi (10D) | ⚠️ aucun en-tête SMTP ni paramètre d'API documenté ne retire le pixel d'ouverture ; le suivi anonyme (activé) n'anonymise que les statistiques ; nos emails n'ont aucun lien à réécrire (inventaire, E9) |
| Restauration | ✅ 9 stations supprimées après la sauvegarde, restauration en 27 s : 5 000 stations, même empreinte de la table, mêmes stocks et stats ; restauration des fichiers vérifiée en local seulement (aucun justificatif sur le staging au moment du test) |
| Retour arrière | ✅ `make rollback-staging v=16bdbec` : api, worker et proxy sur la version demandée |
| Surveillance | ✅ `.github/workflows/monitor.yml` essayé en local (panne détectée, certificat lu) ; première exécution planifiée après la fusion |
| App `preview` (build 17) | ✅ APK EAS en distribution interne, bandeau Staging, API du staging ; Maestro sur Galaxy S10 (Android 12) : recherche sans compte, itinéraire, inscription, gérant de l'inscription aux stocks, **push réel reçu** (notification « Station suspendue » dans le volet) ; 2 `POST /me/devices` pour deux parcours (5 068 en 10 min avec la build 15) ; comptes de test supprimés. Recherche et itinéraire depuis la position réelle du téléphone (position simulée impossible sur un vrai appareil) |

## 3. Vérifié le 2026-10-21

| Vérification | Résultat |
|---|---|
| CI GitHub Actions (`feat/hardening`) | ✅ Backend 5 min 18 (lint, sqlc à jour, govulncheck, tests `-race` avec intégration), Web 2 min 09, Mobile 1 min 49, Security 1 à 4 min (gitleaks, trivy) ; déclenchement par dossier vérifié |
| Go, Web et Mobile lancés ensemble, 3 fois de suite | ✅ 3 sur 3 sans échec : Go 31 paquets (`make test`, 166 à 175 s), Web 127/127, Mobile 244/244 (causes et correctifs au §3 bis) |
| `make lint`, Web `lint` / `typecheck` / `build`, Mobile `lint` / `typecheck` | ✅ |
| Web `check:bundle` | ✅ 147,5 Ko gzip (budget 200 Ko) ; le SDK de suivi des plantages est chargé à part |
| E2E Playwright accessibilité + cartes, sous la CSP de production | ✅ aucune violation de CSP ni d'accessibilité ; cartes chargées sous COEP (`crossOriginIsolated`) |
| govulncheck, gosec, npm audit, gitleaks, trivy | ✅ rien de critique ou d'élevé corrigible non corrigé (`docs/security/scans.md`) |
| OWASP ZAP (API, admin) | ✅ API : 0 alerte ; admin : 3 avertissements acceptés (`docs/security/zap.md`) |
| Répétition de la production (`deploy/rehearsal.compose.yml`) | ✅ 9 services sains, seul Caddy publie des ports, TLS, en-têtes, inscription gérant avec justificatif sur S3, admin par `scripts/prod.sh`, sauvegarde puis restauration (justificatif relu et déchiffré à l'identique), GlitchTip sans aucune IP de client (`docs/DEPLOY.md` §13) |
| Base de dev | ✅ 4 comptes `@example.bj` et 2 stations hors seed supprimés (avec sessions Redis et fichier) ; Mailpit vide ; conteneur orphelin et 12 anciennes images supprimés |

**Non vérifié** : E2E Maestro, Flashlight, bench, Lighthouse, captures ; build EAS avec le SDK Sentry natif (à faire : `eas build --profile preview`) ; essai sur téléphone ; un vrai serveur.

### 3 bis. Tests sous charge

Cause des dépassements de délai (4 relevés le 2026-10-20, jusqu'à 9 sous une charge plus forte) : la machine était 3 à 4 fois surchargée (charge moyenne 21 sur 8 cœurs, sans swap) quand Go (`-race`, un PostGIS par paquet), Vitest et Jest tournaient ensemble, chacun avec un worker par cœur ; s'y ajoutaient des coûts évitables. Corrigé à la source :

- Mobile : `require('lucide-react-native')` coûtait ~2 s par fichier de test (1 900 icônes) → icônes chargées à la demande (`src/test/lucide-lazy.js`) ; suite seule de 39 s à 17 s.
- Mobile : le suivi de la copie de données attendait 3 s réelles → horloge simulée.
- Web : les feuilles de style injectées par sonner et input-otp rendaient chaque `getComputedStyle` coûteux → retirées en test (CPU du parcours 2FA : 1,5 s → 0,9 s) ; modules du parcours 2FA préchargés.
- Go : `TestAccessLogMasksCoordinates` échouait au hasard (l'horodatage contenait parfois « 6.5 »).
- Vitest et Jest sur la moitié des cœurs.

Dernier recours, justifié dans la configuration : délais de 15 s par test et de 3 s par attente (au lieu de 5 s et 1 s). Les suites seules restent sous 2 s par test.

### 3 ter. Défauts révélés par le staging

Tous corrigés sur `feat/staging`, chacun avec un test de régression qui échoue sur l'ancien code :

| Défaut | Effet | Correctif |
|---|---|---|
| **Boucle d'enregistrement de l'appareil push** (Android) | Lire le token réémet l'événement de token (expo-notifications) : chaque `POST /me/devices` déclenchait le suivant, jusqu'à 15 par seconde (5 068 en 10 min), plus un appel à l'API d'Expo à chaque tour ; les 5 connexions d'OkHttp occupées faisaient attendre les autres requêtes (parcours gérant en échec) | Seul un token d'appareil différent du dernier vu réenregistre (`registration.test.ts`) |
| Plantage de test inopérant | `Sentry.nativeCrash()` intercepté par ReactHost sous la New Architecture : écran blanc, rien d'envoyé | Erreur JavaScript fatale hors de React, le cas le plus courant (`app-env.test.ts`) ; elle arrive dans GlitchTip (étape 10D) |
| Plantages de l'app non reçus par GlitchTip | Diagnostic de l'étape 10D (build avec `debug: true`, logcat) : le SDK démarrait avec le bon DSN, captait les erreurs (fatales comprises, avant l'arrêt de l'instance React) et les mettait en file ; l'envoi échouait (« Envelope submission failed », `UnknownHostException`) car le téléphone ne résolvait pas `errors.gostation.bj` (zone DNS incohérente, ligne DNS du §3). Avec un résolveur sain, les enveloppes en file sont parties (« Envelope sent successfully ») | Rien à corriger dans l'app ; la zone DNS est à corriger chez Wayhost. `scripts/check-dns.sh` (`make check-dns`, surveillance toutes les 30 min) détecte ce cas ; `EXPO_PUBLIC_SENTRY_DEBUG=1` active le diagnostic dans une build `preview` (`error-tracking.test.ts`) |
| Texte invisible dans les emails | Pré-en-tête masqué et liseré en `font-size:0` : `FONT_INVIS_MSGID` (−2,5), mail-tester 6,9/10 | Pré-en-tête retiré (il répétait le texte visible), liseré en bordure ; 9,3/10 (`TestEmailsHaveNoHiddenText`) |
| Palette ⌘K pendant une recherche | Indicateur `role="status"` dans la `listbox` (axe : `aria-required-children`, critique), visible seulement avec la latence réelle | Région de statut hors de la liste, toujours montée (`command-menu.test.tsx`) |
| Version perdue après une restauration | `restore`, `migrate`, `errtrack-test` lançaient `gostation-api:latest` (construite au passage) | `RELEASE` = version en service (`var/releases`, aussi écrit par `rollback`) |
| Déploiement lié à la session SSH | Une coupure réseau (deux pendant l'étape) aurait interrompu un build ou une migration | `scripts/prod.sh deploy` lancé sous `nohup`, journal suivi depuis le poste |

Corrigé aussi : le scénario E2E de réordonnancement au clavier, qui envoyait la flèche avant que dnd-kit l'écoute.

> **Note sur l'historique** : le message du commit `65d6d2d` (« fix(mobile): make the staging test crash reach GlitchTip ») est inexact. Ce commit remplace bien `Sentry.nativeCrash()` par une erreur JavaScript fatale, mais aucun rapport n'atteignait GlitchTip à ce moment-là. Le commit étant dans `main`, son message n'a pas été réécrit.

## 4. Ce qui reste à faire

### Bloquant pour la mise en production

1. **Zone DNS de gostation.bj** (Wayhost) : un seul jeu de serveurs, identique dans la délégation du `.bj` et dans la zone, sans `ns1.netim.net` ou avec une zone à jour, même numéro de série partout, serveurs qui répondent ; puis `www`. Contrôle : `make check-dns` sans écart (aussi dans la surveillance).
2. **Serveur de production** distinct du staging (même runbook, `docs/DEPLOY.md` §3 à §12 ; localisation des données : avis du juriste, D4), avec son `.env.production`, son GlitchTip et sa copie de sauvegarde ; puis repointer l'environnement EAS `production` (aujourd'hui sur l'API du staging) et y ajouter `EXPO_PUBLIC_SENTRY_DSN`.
3. **Brevo** : son pixel d'ouverture ne se coupe ni par SMTP ni par l'API (le suivi anonyme, activé, n'anonymise que les statistiques). Obtenir sa désactivation du support de Brevo, ou passer à un fournisseur qui le coupe par message (inventaire, écart E9 ; question 24 au juriste).
4. **Juridique** : identité du responsable, réponses du juriste (24 questions, dont la copie des sauvegardes sur Google Drive et Brevo), 21 « À COMPLÉTER », formalités APDP F1 à F5, `PRIVACY_CONTACT_EMAIL` (provisoirement l'adresse personnelle sur le staging), localisation du VPS (en attente de Wayhost).
5. **Google Play** : compte, fiche, « Sécurité des données » (journaux de plantage), URL `https://gostation.bj/politique-confidentialite` et `https://gostation.bj/suppression-compte` (pages en ligne, mais concernées par le DNS), clé de service pour `eas submit`.

### Important

- **Suivi des plantages natifs** : une exception d'un module natif reste interceptée par ReactHost sans rapport (`@sentry/react-native` 7.11 n'a pas le gestionnaire Expo de la 8.x) ; les erreurs JavaScript, fatales comprises, remontent.
- Mesurer la perf sur un Android de 2 à 3 Go (D50) ; Lighthouse mobile de l'admin (84 et 62, cible 85).
- `www.gostation.bj` : une fois le DNS corrigé chez Wayhost, `PUBLIC_EXTRA_HOSTS=www.gostation.bj` puis `make deploy-staging`.
- Limiter `POST /me/devices` côté serveur (quota par session) : la boucle corrigée dans l'app aurait dû être freinée par l'API aussi.
- Écarts ASVS acceptés ou à traiter (`docs/security/asvs.md`) : sessions mobiles glissantes sans plafond, pas de poivre sur les mots de passe, pas d'antivirus sur les justificatifs, code par email de 15 min, indicateur de robustesse absent, inscription non générique.
- Dépendances : 4 paquets Expo en retard de correctif (`expo install --check`), à monter avec un build ; `braces` et `node-forge` sans version corrigée (outillage de build, `scans.md`).
- E7 : contrat OpenFreeMap ou tuiles auto-hébergées.

### Plus tard

- iOS ; historique des stocks du gérant ; V2 (plusieurs stations, employés, prix, OTP SMS) ; envoi des source maps à GlitchTip ; worker en plusieurs instances (scheduler séparé).

## 5. Écarts par rapport à CLAUDE.md et ARCHITECTURE §9

| Règle ou décision | Constat |
|---|---|
| « `main` protégée, PR en squash merge » | CI verte avant la fusion, mais fusion locale en merge commit et `main` non protégée (protection indisponible sur un dépôt privé gratuit) |
| D45 : Lighthouse mobile ≥ 85 | 84 et 62 (non remesuré) |
| D49, D50 | iOS jamais compilé ; cible de 2 à 3 Go non mesurée |
| Inventaire E2 à E5, E7 | En attente du juriste (E1 et E6 corrigés) |

Corrigés depuis le 2026-10-20 : CI absente, données de test dans la base de dev, stockage S3, version de la spec OpenAPI (0.9.0), E1, E6.

## 6. Dette technique et risques

- **Délais de test relevés** (15 s, 3 s) en dernier recours : un test vraiment lent passerait plus longtemps inaperçu ; les causes évitables sont corrigées (§3 bis).
- **SIGSEGV de Node** observés deux fois pendant les passages concurrents (un worker Vitest, un worker Jest), sans test en cause ni trace dans le journal du noyau : runtime ou machine, à surveiller en CI.
- **Worker en instance unique** ; **un seul serveur** (pas de haute disponibilité) : les sauvegardes et le runbook de restauration couvrent la perte du serveur.
- **Sauvegardes** : le jeton Google Drive est sur le serveur ; un serveur compromis pourrait effacer la copie (30 jours de corbeille Drive seulement). En production : un remote à verrouillage d'objets, ou une copie tirée depuis une autre machine.
- **Wayhost** : pare-feu du panneau et limite de connexions SSH en amont du serveur (contournés et documentés, `docs/DEPLOY.md` §17) ; un seul VPS pour le staging.
- **Surveillance** sur le quota gratuit d'Actions (~1 440 min/mois sur 2 000) : si le quota est épuisé, la CI et la surveillance s'arrêtent ensemble.
- **DNS de gostation.bj** : tant que la zone est incohérente (§3), une partie des utilisateurs ne joindra ni l'admin, ni GlitchTip, ni peut-être l'API ; la surveillance le signale toutes les 30 min.
- **Maestro** : un `retry` et 5 étapes `optional: true` ; **contournements** documentés (D56, D75, D77).

## 7. Ce qui dépend de vous

| # | Action | Détail |
|---|---|---|
| 1 | **Wayhost : zone DNS** | Compléter le ticket avec la sortie de `make check-dns` : délégation `.bj` (dns1, dns3.itnet-technologies.com) différente des NS de la zone ; `ns1.netim.net` sert une ancienne zone (série 2610200012 : ni `api`, ni `admin`, ni `errors`, apex sur 45.93.21.77) ; séries différentes ; 45.93.21.13 et 45.93.21.18 répondent une fois sur deux ; `www` sur 45.93.21.77. Demander aussi la localisation du VPS |
| 2 | **Brevo** | Demander au support la désactivation du suivi des ouvertures et des clics du compte, sinon choisir un autre fournisseur (Mailjet le coupe par message) |
| 3 | **Google Drive** | Supprimer le dossier `gostation-backups-ancien` ; retirer l'accès de l'ancienne application « rclone » (myaccount.google.com/permissions) ; supprimer `deploy/staging-old.rclone.conf` |
| 4 | **Compte admin du staging** | Si ce n'est pas fait : `scripts/staging.sh prod admin-create henry.gossou17@gmail.com <Prénom> <Nom>` dans un terminal séparé |
| 5 | **Réception Gmail** | Confirmer que l'email de vérification de `henry.gossou17+inscription@gmail.com` est arrivé (boîte de réception ou spam) |
| 6 | Juriste et APDP | 24 questions (`docs/legal/questions-juriste.md`), formalités, identité du responsable |

## 8. Les 3 prochaines actions recommandées

1. **Faire corriger la zone DNS** (§7, 1) : c'est le seul défaut qui touche déjà de vrais résolveurs ; `make check-dns` dira quand c'est réglé, puis ajouter `www` (`docs/DEPLOY.md` §17).
2. **Trancher Brevo** (§7, 2) avant d'inviter des testeurs extérieurs.
3. **Bêta fermée Android** avec l'APK `preview` auprès de quelques gérants et utilisateurs de Cotonou, en mesurant la perf sur un Android de 2 à 3 Go (D50).
