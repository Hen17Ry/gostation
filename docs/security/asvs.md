# Revue OWASP ASVS niveau 2 (auth, sessions, contrôle d'accès, fichiers, limitation de débit)

> Revue rapide du 2026-10-20 (étape 10B), par lecture du code et des tests, sur la branche `feat/hardening`. Référentiel : **ASVS 4.0.3**, exigences de niveau 1 et 2 des chapitres V2 (authentification), V3 (sessions), V4 (contrôle d'accès), V12 (fichiers) et V11.1 / V13 (limitation de débit et API). Ce n'est pas un audit complet : les chapitres hors périmètre (V5 validation, V7 journalisation, V8 données, V9 communications, V14 configuration) ne sont cités que lorsqu'ils touchent ces thèmes.
>
> Légende : ✅ conforme · 🔧 corrigé pendant cette revue · ⚠️ écart accepté ou à traiter (avec la proposition) · — sans objet.

## Synthèse

| Thème | ✅ | 🔧 | ⚠️ |
|---|---|---|---|
| V2 Authentification | 31 | 1 | 5 |
| V3 Sessions | 17 | 1 | 1 |
| V4 Contrôle d'accès | 9 | 0 | 1 |
| V12 Fichiers | 10 | 0 | 1 |
| Limitation de débit (V11.1, V2.2.1, V13) | 6 | 3 | 1 |

Correctifs faits pendant la revue (commits de `feat/hardening`) :

1. **Sessions admin plafonnées à 12 h depuis la connexion** (3.3.2) : chaque refresh repoussait la fin de la session de 12 h, un admin actif ne se reconnectait donc jamais. `deadline_ms` dans la session Redis, que la rotation ne dépasse pas (`TestSessionMaxAge`).
2. **Limiteurs de l'authentification en échec fermé** (2.2.1) : Redis en panne, les quotas de connexion laissaient passer alors que la vérification du mot de passe continuait en base, un oracle sans limite. Connexion, codes, emails et inscription répondent 503 (`TestLoginFailsClosedWithoutLimiter`, test du middleware).
3. **IPv6 limité par /64** (11.1.4) : un abonné change d'adresse dans son /64 à chaque requête et obtenait un quota neuf (`TestClientIPKeyGroupsIPv6By64`).
4. **Empreintes des limiteurs sous clé** (E1, inventaire) : HMAC-SHA256 sous `RATE_LIMIT_KEY` au lieu d'un SHA-256 sans clé (`TestClientKeysAreKeyed`).

## V2 Authentification

| # | Exigence (résumé) | État | Preuve, commentaire, correctif |
|---|---|---|---|
| 2.1.1 | Mot de passe ≥ 12 caractères | ⚠️ | 8 minimum (`auth.PasswordMinLen`), conforme au NIST 800-63B et à l'ASVS 5.0 (8 minimum, 15 recommandés), plus la liste de mots de passe courants. Public mobile grand public : on garde 8. Proposition : 12 minimum pour les admins (créés par la CLI) |
| 2.1.2 | ≥ 64 caractères acceptés, ≤ 128 refusés au-delà | ✅ | 128 (`PasswordMaxLen`), comptés en caractères Unicode |
| 2.1.3 | Pas de troncature | ✅ | argon2id sur le mot de passe entier |
| 2.1.4 | Tout caractère Unicode accepté | ✅ | Aucune restriction de jeu de caractères (`utf8.RuneCountInString`) |
| 2.1.5 | L'utilisateur peut changer son mot de passe | ✅ | `POST /me/change-password` |
| 2.1.6 | Le changement exige le mot de passe actuel | ✅ | `currentPassword` vérifié (`user_integration_test.go`) |
| 2.1.7 | Refus des mots de passe compromis ou courants | ✅ | Liste embarquée de 2 176 entrées (`common_passwords.txt`, dont des mots de passe courants au Bénin), refus de l'email et de « gostation » |
| 2.1.8 | Indicateur de robustesse | ⚠️ | Absent (mobile et web). Proposition : indicateur simple dans le champ de création (règles du serveur seulement) |
| 2.1.9 | Pas de règles de composition | ✅ | Aucune règle de types de caractères |
| 2.1.10 | Pas de rotation périodique imposée | ✅ | — |
| 2.1.11 | Collage et gestionnaires de mots de passe permis | ✅ | Champs `autoComplete` (`new-password`, `current-password`), collage non bloqué |
| 2.1.12 | Affichage temporaire du mot de passe | ✅ | Bouton « afficher » (`Mobile/src/components/ui/text-field.tsx`, `Web/src/features/auth/credentials-step.tsx`) |
| 2.2.1 | Anti-automatisation (force brute, bourrage d'identifiants) | 🔧 | 5/min par IP **et** par email (HMAC), 30 codes / 10 min par IP, 5 essais par code ou défi 2FA. **Corrigé** : échec fermé si Redis tombe (voir synthèse) |
| 2.2.2 | Authentificateurs faibles (SMS, email) en secours seulement | ✅ | L'email ne sert qu'à vérifier l'adresse et à réinitialiser ; jamais de connexion par email seul |
| 2.2.3 | Notification après changement d'un authentificateur | ✅ | Email « mot de passe modifié » après changement et réinitialisation (`PasswordChanged`) ; la 2FA admin ne se réinitialise que par la CLI (`make admin-reset-2fa`) |
| 2.2.4 (L3) | — | — | — |
| 2.4.1 | Stockage par fonction de dérivation résistante | ✅ | argon2id, paramètres OWASP (19 MiB, t = 2, p = 1), format PHC, re-hash au login si les paramètres changent |
| 2.4.2 | Sel ≥ 32 bits, unique | ✅ | 16 octets aléatoires par mot de passe |
| 2.4.4 | Coût suffisant | ✅ | Paramètres OWASP ; sémaphore borne les calculs simultanés (pas de déni de service par argon2) |
| 2.4.5 | Itération supplémentaire avec un sel secret (poivre) | ⚠️ | Absent. Proposition : HMAC du mot de passe sous une clé hors base avant argon2id, appliqué au prochain login de chaque compte (re-hash existant) |
| 2.5.1 | Secret de récupération non envoyé en clair, à usage unique | ✅ | Code à 6 chiffres à usage unique, stocké en HMAC, 15 min, 5 essais |
| 2.5.2 | Pas d'indice ni de question secrète | ✅ | — |
| 2.5.3 | La récupération ne révèle pas le mot de passe | ✅ | — |
| 2.5.4 | Pas de compte partagé ou par défaut | ✅ | Admins créés un par un par la CLI, aucun compte par défaut |
| 2.5.5 | Notification au changement d'un facteur | ✅ | Voir 2.2.3 |
| 2.5.6 | Récupération par mécanisme sûr | ✅ | Code à usage unique, réponses génériques (anti-énumération), toutes les sessions révoquées après réinitialisation |
| 2.5.7 | Perte du facteur OTP : preuve d'identité | ✅ | Réinitialisation de la 2FA par un opérateur seulement (CLI sur le serveur), auditée |
| 2.7.2 | Code hors bande valable 10 min au plus | ⚠️ | 15 min (`OTPTTL`), pour laisser le temps à un email lent d'arriver sur mobile. 5 essais par code, renvoi limité : risque faible. Proposition : 10 min si les délais de livraison SMTP de production le permettent |
| 2.7.3 | Code hors bande à usage unique, lié à la demande | ✅ | Détruit après usage ou au 5e échec (Lua atomique), lié au compte et à l'usage (`otp:{usage}:{uid}`) |
| 2.7.4 | Codes générés par un aléa sûr | ✅ | `crypto/rand` |
| 2.7.6 | ≥ 20 bits d'entropie | ✅ | 6 chiffres ≈ 20 bits, 5 essais |
| 2.8.1 | OTP à durée de vie définie | ✅ | TOTP 30 s, ± 1 pas |
| 2.8.3 | Algorithmes approuvés | ✅ | HMAC-SHA1 (RFC 6238), secret de 160 bits chiffré en AES-256-GCM |
| 2.8.4 | Un TOTP n'est accepté qu'une fois | ✅ | Anti-rejeu : pas déjà accepté refusé |
| 2.8.5 | Réutilisation journalisée | ✅ | Échecs 2FA au journal d'audit |
| 2.8.6 | Révocation du facteur | ✅ | `make admin-reset-2fa` ; 10 codes de secours à usage unique, hachés |
| 2.10.x | Secrets d'intégration hors du code | ✅ | `.env` seulement, gitleaks sur tout l'historique : 0 fuite |
| — | Anti-énumération | ⚠️ | Login, admin/login, forgot, resend, verify, reset : réponses et temps identiques (hash factice). **L'inscription** répond `auth.email_taken` (409) : choix produit pour l'ergonomie mobile, limité à 10 inscriptions / h par IP. Proposition si besoin : réponse 202 générique et email « vous avez déjà un compte » |

## V3 Sessions

| # | Exigence (résumé) | État | Preuve, commentaire, correctif |
|---|---|---|---|
| 3.1.1 | Pas de jeton de session dans l'URL | ✅ | Bearer (mobile) ou cookies (admin). Les liens signés d'export et de copie (`sig`, 1 h) exigent en plus la session |
| 3.2.1 | Nouveau jeton à l'authentification | ✅ | Nouvelle session et nouveau refresh token à chaque connexion |
| 3.2.2 | ≥ 64 bits d'entropie | ✅ | Refresh token de 256 bits (`gsr_…`), access JWT signé |
| 3.2.3 | Stockage sûr côté client | ✅ | Mobile : expo-secure-store (refresh), mémoire (access). Web : cookies `HttpOnly; Secure; SameSite=Strict`, jamais de stockage du navigateur |
| 3.2.4 | Algorithmes approuvés | ✅ | EdDSA (Ed25519) seul accepté, `kid`, rotation des clés |
| 3.3.1 | Le logout invalide la session côté serveur | ✅ | Session supprimée de Redis ; chaque requête vérifie la session (l'access token devient inutilisable aussitôt) |
| 3.3.2 | Ré-authentification périodique (L2 : 12 h, ou 30 min d'inactivité) | 🔧 ⚠️ | **Admin corrigé** : 12 h au plus depuis la connexion, même en activité. **Utilisateurs et gérants** : 30 jours glissants sans plafond. Écart accepté : app mobile à faibles privilèges, refresh token rotatif à détection de réutilisation (vol → révocation de toute la session), sessions visibles et révocables (`/me/sessions`), et les rappels de stock des gérants cesseraient à chaque expiration. Le mécanisme (`Session.MaxAge`) permet un plafond si le juriste ou l'usage l'exige |
| 3.3.3 | Option de fermer les autres sessions après un changement de mot de passe | ✅ | Fait d'office : changement → toutes les autres sessions révoquées ; réinitialisation → toutes |
| 3.3.4 | Voir et fermer ses sessions | ✅ | `GET /me/sessions`, `DELETE /me/sessions/{id}`, `POST /auth/logout-all` |
| 3.4.1 | Cookie `Secure` | ✅ | `COOKIE_SECURE=true` (refusé à `false` en production) |
| 3.4.2 | Cookie `HttpOnly` | ✅ | `__Host-gs_at`, `__Secure-gs_rt` ; seul `gs_csrf` est lisible (par conception) |
| 3.4.3 | Cookie `SameSite` | ✅ | `Strict` |
| 3.4.4 | Préfixe `__Host-` | ✅ | Access token en `__Host-`, refresh en `__Secure-` (chemin restreint à `/api/v1/auth`) |
| 3.4.5 | Chemin le plus restrictif | ✅ | Refresh sur `/api/v1/auth` seulement |
| 3.5.2 | Pas de secret statique en guise de session | ✅ | — |
| 3.5.3 | Jetons sans état signés et vérifiés | ✅ | Signature, `iss`, `aud`, `exp`, `nbf`, et existence de la session (`sid`) à chaque requête |
| 3.7.1 | Ré-authentification avant une action sensible | ✅ | Mot de passe exigé pour le changer et pour supprimer le compte. Actions admin : session de 12 h au plus avec 2FA, motif et audit |
| — | Réutilisation d'un refresh token | ✅ | Révoque toute la session, auditée (`refresh_reuse_detected`) ; clients en single-flight (règle 15) |

## V4 Contrôle d'accès

| # | Exigence (résumé) | État | Preuve, commentaire, correctif |
|---|---|---|---|
| 4.1.1 | Contrôle côté serveur | ✅ | Middlewares `Authenticate` → `RequireRole` → `RequireVerifiedEmail` / `RequireStationStatus` / `RequireCookieSession` |
| 4.1.2 | Attributs d'autorisation non modifiables par le client | ✅ | Rôle porté par le JWT signé (EdDSA seul accepté), session vérifiée à chaque requête ; vérification de l'email et statut de la station lus en base à chaque requête (une suspension prend effet immédiatement) ; désactivation d'un compte → sessions révoquées |
| 4.1.3 | Moindre privilège | ✅ | Gérant non approuvé : `/me` seulement ; admin : jamais les stocks |
| 4.1.5 | Échec sûr | ✅ | Erreur → refus (problem+json), panics interceptés (500 générique) |
| 4.2.1 | Pas d'accès direct à l'objet d'un autre (IDOR) | ✅ | Gérant : routes sans identifiant (`/manager/station`, sa station seulement) ; `/me/*` lié au `sub` ; favoris, notifications, copies : filtrés par utilisateur ; justificatif : admin seul, audité |
| 4.2.2 | Protection CSRF | ✅ | Admin : jeton `HMAC(clé, sid)` sur toute écriture (refresh et logout compris), `SameSite=Strict`, Bearer refusé ; mobile : Bearer (pas de cookie) |
| 4.3.1 | MFA sur les interfaces d'administration | ✅ | 2FA TOTP obligatoire, claim `mfa` exigé par `RequireRole(admin)` |
| 4.3.2 | Pas de listage de répertoires ni de métadonnées exposées | ✅ | Caddy `file_server` sans `browse` ; aucun `.git` ni source map dans le build (`sourcemap: false`) |
| 4.3.3 | Validation supplémentaire pour les actions à fort impact | ⚠️ | Les actions admin destructives exigent un motif, une confirmation et l'`If-Match`, mais pas de nouvelle saisie TOTP. Proposition : re-vérification TOTP pour la suppression de compte et l'export de données (V2) |
| — | Validation stricte de l'admin | ✅ | JSON sans champ inconnu, paramètres inconnus ou répétés refusés, pagination par curseur (D40) |

## V12 Fichiers (justificatifs IFU, exports)

| # | Exigence (résumé) | État | Preuve, commentaire, correctif |
|---|---|---|---|
| 12.1.1 | Taille maximale | ✅ | 5 Mo (`DOCUMENTS_MAX_BYTES`), corps borné avant lecture (5 Mo + 256 Ko) ; Caddy borne aussi à 6 Mo |
| 12.1.2 | Archives (bombes de décompression) | — | Aucune archive acceptée |
| 12.1.3 | Quota par utilisateur | ✅ | Un justificatif par station (le renvoi remplace l'ancien), 10 inscriptions / h par IP |
| 12.2.1 | Type vérifié par le contenu | ✅ | Magic bytes : PDF, JPEG, PNG seulement ; le type annoncé par le client est ignoré |
| 12.3.1 | Nom de fichier du client jamais utilisé | ✅ | Clé de stockage générée (`stations/{uid}/{uuid}.bin`) |
| 12.3.2 | Pas de traversée de chemin | ✅ | `Local.path` refuse les clés absolues ou contenant `..` |
| 12.3.6 | Pas d'inclusion de fichier distant (SSRF) | ✅ | Aucune URL fournie par un utilisateur n'est lue par le serveur |
| 12.4.1 | Stockage hors de la racine web | ✅ | Stockage objet ou disque local, chiffré (enveloppe AES-256-GCM, empreinte SHA-256 vérifiée), jamais servi publiquement |
| 12.4.2 | Analyse antivirus des fichiers non fiables | ⚠️ | Absente. Atténuations : seuls des PDF, JPEG et PNG passent ; métadonnées retirées des images ; le fichier n'est lu que par un admin, déchiffré en mémoire, retypé d'après une liste blanche et rendu par pdf.js dans un canvas (XFA coupé, pas de script) sous la CSP de l'admin. Proposition : ClamAV dans le worker si le volume ou le risque augmente |
| 12.5.1 | Seules les extensions prévues sont servies | ✅ | Admin : build statique ; API : JSON et téléchargements par endpoint dédié |
| 12.5.2 | Un fichier envoyé n'est jamais exécuté | ✅ | `Content-Disposition: attachment`, `nosniff`, type issu de la liste blanche |
| 12.6.1 | Liste blanche des appels sortants | ✅ | OSRM, Expo Push et SMTP : URL de la configuration seulement |

## Limitation de débit (V11.1.4, V2.2.1, V13.2)

| # | Exigence (résumé) | État | Preuve, commentaire, correctif |
|---|---|---|---|
| 11.1.2 | Limites métier par utilisateur | ✅ | Signalements (1 par station et motif / 2 h, 10 / jour, comptés en base sous verrou), favoris (20), alertes « de retour en stock » (D30), une copie de données à la fois |
| 11.1.4 | Anti-automatisation | 🔧 | Quota global 1 200/min par IP, recherche 300/min par IP + 30/min par installation ou compte, inscription 10/h. **Corrigé** : IPv6 par /64 |
| — | Fenêtre glissante exacte | ✅ | Pas de rafale au changement de fenêtre (`ratelimit_integration_test.go`) |
| — | Clés des limiteurs | 🔧 | HMAC sous `RATE_LIMIT_KEY` (E1) ; ni IP ni identifiant en clair dans Redis |
| — | Comportement si Redis tombe | 🔧 | Échec ouvert pour le quota global et la recherche (disponibilité) ; **échec fermé** pour l'authentification et l'inscription |
| — | IP réelle derrière le proxy | ✅ | `X-Forwarded-For` lu seulement depuis `HTTP_TRUSTED_PROXIES` (réseau de Caddy) ; Caddy remplace celui du client |
| — | En-têtes `RateLimit-*` et `Retry-After` | ✅ | Posés sur chaque réponse limitée |
| 13.2.1 | Méthodes HTTP limitées | ✅ | 405 en problem+json pour une méthode non prévue |
| 13.2.5 | Type de contenu vérifié | ✅ | Corps JSON refusé (415) si un autre `Content-Type` qu'`application/json` est annoncé ; multipart seulement sur les deux routes de justificatif |
| — | CGNAT | ⚠️ | Beaucoup d'abonnés mobiles béninois partagent une IP : les quotas par IP sont volontairement larges et complétés par des quotas par installation ou compte (D22). Un attaquant derrière la même IP qu'un utilisateur peut épuiser le quota de recherche de cette IP (300/min) : accepté |

## En-têtes et exposition (rappel, V14.4)

API et admin posent HSTS, `nosniff`, `Referrer-Policy: no-referrer` et `frame-ancestors 'none'` ; l'admin a une CSP stricte par empreintes (ARCHITECTURE §6.3, `Web/build/csp.ts`). Les résultats du scan OWASP ZAP sont dans [`zap.md`](zap.md), ceux des analyses automatisées dans [`scans.md`](scans.md).
