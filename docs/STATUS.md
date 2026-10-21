# GoStation — État des lieux

> Mis à jour le 2026-10-21 après l'étape 10B (sécurité, CI, stabilisation, préparation du déploiement), branche `feat/hardening` fusionnée dans `main`. Première version : 2026-10-20 sur `7e7ae97`. Chaque affirmation vient d'une commande exécutée ou d'un fichier cité ; ce qui n'a pas été vérifié est signalé (§3, fin).

## 1. Résumé

- Le code de la V1 est complet ; l'étape 10B est faite : sécurité (E1, E6, en-têtes, CSP stricte, revue ASVS, scans), tests stables, CI GitHub Actions verte, suivi des plantages (GlitchTip), déploiement prêt et **répété de bout en bout en local** (compose de production, TLS, stockage S3, sauvegarde et restauration).
- **Rien n'est encore déployé** : il manque un serveur, un domaine, un SMTP et deux buckets S3 (liste exacte au §7). Avec eux, le staging se monte en suivant `docs/DEPLOY.md`.
- Juridique toujours en projet : 21 « À COMPLÉTER » (politique 12, CGU 4, registre 3, page de suppression 1, fiche Play 1), aucune formalité APDP.
- Bêta fermée Android : possible dès le staging en ligne, `EXPO_PUBLIC_API_URL` renseigné dans EAS et un nouveau build (le SDK de suivi des plantages est natif, et aucun build ne contient encore « Mes données »).

## 2. Étapes

| # | Étape | État | Commit / branche |
|---|---|---|---|
| 0 à 7 | Fondations, socle, auth, stations, recherche, notifications, API admin, web admin | ✅ Faites | voir l'historique (`git log --merges`) |
| 8 | Mobile : parcours utilisateur, gérant, push, build | 🟡 Android fait ; build `production` sans URL d'API ; iOS jamais construit | `feat/mobile`, `feat/mobile-manager`, `feat/push` |
| 9a | Données personnelles | ✅ Code fait ; textes en projet | `feat/privacy` → `7e7ae97` |
| 9b | Sécurité (10B) | ✅ Faite | `feat/hardening` |
| 9c | Tests et CI | ✅ CI verte ; perf mobile non mesurée sur la cible (D50) | `feat/hardening` |
| 9d | Déploiement (10C) | 🟡 Prêt et répété en local ; aucun serveur | `feat/hardening` |

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

## 4. Ce qui reste à faire

### Bloquant pour la mise en production

1. **Serveur, domaine, SMTP, stockage S3** : choisir les fournisseurs (localisation des données : avis du juriste, D4), puis `docs/DEPLOY.md`. Liste exacte au §7.
2. **URL de l'API dans l'app** : `EXPO_PUBLIC_API_URL` (et `EXPO_PUBLIC_SENTRY_DSN`) dans l'environnement EAS `production`, puis un build.
3. **Juridique** : identité du responsable, réponses du juriste (23 questions), 21 « À COMPLÉTER », formalités APDP F1 à F5, `PRIVACY_CONTACT_EMAIL`.
4. **Google Play** : compte, fiche, « Sécurité des données » (mise à jour : journaux de plantage), URL `https://<domaine>/politique-confidentialite` et `https://<domaine>/suppression-compte` (pages prêtes), clé de service pour `eas submit`.

### Important

- Nouveau build Android (SDK natif de suivi des plantages, « Mes données », réacceptation) et essai sur téléphone.
- Mesurer la perf sur un Android de 2 à 3 Go (D50) ; Lighthouse mobile de l'admin (84 et 62, cible 85).
- Écarts ASVS acceptés ou à traiter (`docs/security/asvs.md`) : sessions mobiles glissantes sans plafond, pas de poivre sur les mots de passe, pas d'antivirus sur les justificatifs, code par email de 15 min, indicateur de robustesse absent, inscription non générique.
- Dépendances : 4 paquets Expo en retard de correctif (`expo install --check`), à monter avec un build ; `braces` et `node-forge` sans version corrigée (outillage de build, `scans.md`).
- E7 : contrat OpenFreeMap ou tuiles auto-hébergées.
- Base de dev : 2 comptes admin qui ressemblent à des comptes de test (`ada.1791655991@gostation.bj`, `docker.admin.1791656110@gostation.bj`, créés le 10/10 avec les comptes `@example.bj`) : à supprimer si vous confirmez.

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
- **Sauvegardes** : la clé du bucket des sauvegardes est sur le serveur ; activer le verrouillage d'objets chez le fournisseur.
- **Maestro** : un `retry` et 5 étapes `optional: true` ; **contournements** documentés (D56, D75, D77).

## 7. Ce qui dépend de vous

Pour **déployer le staging**, il me faut exactement :

| # | Élément | Détail |
|---|---|---|
| 1 | **VPS** | Ubuntu Server LTS (26.04 ou 24.04), 2 vCPU, 4 Go de RAM, 40 Go SSD, IPv4 publique ; accès SSH par clé pour un utilisateur sudo. Localisation à valider avec le juriste |
| 2 | **Domaine** | Le nom choisi et l'accès à sa zone DNS, pour créer 5 enregistrements A (et AAAA) vers le serveur : `<domaine>`, `www`, `api`, `admin`, `errors` ; une adresse pour Let's Encrypt (`ACME_EMAIL`) |
| 3 | **SMTP** | Hôte, port (587 ou 465), identifiant et mot de passe, adresse d'expédition (`no-reply@<domaine>`) ; domaine d'envoi vérifié chez le fournisseur (SPF, DKIM, DMARC à ajouter au DNS) |
| 4 | **Stockage S3** | Fournisseur compatible S3 : endpoint, région, **deux buckets privés** (fichiers ; sauvegardes, si possible avec verrouillage d'objets, idéalement ailleurs que le serveur) et **deux clés d'accès**, chacune limitée à son bucket |
| 5 | Contact vie privée | L'adresse `PRIVACY_CONTACT_EMAIL` (affichée dans les emails et la page de suppression) |
| 6 | EAS | Rien à fournir : je crée `EXPO_PUBLIC_API_URL` et `EXPO_PUBLIC_SENTRY_DSN` dans l'environnement EAS une fois l'URL connue |

Le reste (secrets, GlitchTip, admin, sauvegardes) se génère sur le serveur (`docs/DEPLOY.md` §8). Ensuite, hors staging : juriste et APDP (§4), compte Google Play, décision iOS, téléphone de test de 2 à 3 Go.

## 8. Les 3 prochaines actions recommandées

1. **Choisir l'hébergeur, le domaine, le SMTP et le stockage S3** (§7), en tenant compte de l'avis du juriste sur la localisation ; lancer en parallèle les 23 questions au juriste.
2. **Monter le staging** avec `docs/DEPLOY.md` (environ une demi-journée), puis `EXPO_PUBLIC_API_URL` dans EAS et un build `preview` : c'est la bêta fermée Android.
3. **Mesurer sur un Android de 2 à 3 Go** (démarrage à froid, 60 fps, RAM) avant d'ouvrir la bêta au-delà de quelques testeurs.
