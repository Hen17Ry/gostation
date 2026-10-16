# Inventaire des données personnelles — GoStation

> **PROJET — à faire valider par un juriste.** Document interne, établi à partir du code au 16 octobre 2026 (étape 10A). Il décrit ce que fait réellement le logiciel ; il sert de base à la politique de confidentialité, au registre des traitements et aux formalités auprès de l'APDP.

**Méthode.** Relecture du schéma (migrations `Backend/db/migrations`, 29 tables), des requêtes (`Backend/db/queries`), des clés Redis, des attributs de journalisation (`slog`) de l'API et du worker, des fichiers stockés (`DOCUMENTS_STORAGE_DIR`), du stockage local des apps (MMKV, SecureStore, `sessionStorage`) et des services tiers appelés. Les durées sont les valeurs par défaut de `Backend/internal/config` ; toutes sont réglables (`RETENTION_*`, `PRIVACY_*`) et restent **à valider par un juriste**.

**Personnes concernées.** Utilisateurs sans compte ; utilisateurs avec compte ; gérants de station (et, à travers eux, la station, personne morale le plus souvent) ; administrateurs GoStation.

**Abréviations.** *Contrat* : exécution des conditions d'utilisation. *IL* : intérêt légitime. *Consentement* : autorisation donnée au système du téléphone. *Obligation* : obligation légale (droits des personnes, preuve de conformité).

## 1. Base de données (PostgreSQL)

| Donnée | Emplacement | Finalité | Base légale | Conservation | Accès |
|---|---|---|---|---|---|
| Identité du compte : email, prénom, nom, rôle, statut | `users.email`, `first_name`, `last_name`, `role`, `status` | Gestion du compte, connexion, emails | Contrat | Durée du compte ; à la suppression, anonymisation immédiate (email `deleted+<id>@anonymized.invalid`, nom « Deleted User ») ; compte inactif supprimé à 24 mois, prévenu 30 jours avant | La personne (profil, copie) ; admin (fiche compte) |
| Mot de passe | `users.password_hash` (argon2id), `password_changed_at` | Authentification | Contrat, sécurité | Durée du compte ; remplacé par une valeur invalide à la suppression | Personne (aucune lecture possible) |
| Dates d'activité et de consentement | `users.created_at`, `email_verified_at`, `last_login_at`, `last_active_at`, `inactivity_warned_at`, `privacy_policy_version`, `privacy_accepted_at`, `deletion_requested_at` | Sécurité, purge des comptes inactifs, preuve de l'acceptation de la politique | IL, obligation (preuve) | Durée du compte ; conservées sur la ligne anonymisée (sans identité) | Admin, personne (copie) |
| Modération du compte | `users.disabled_at`, `disabled_reason`, `reporting_banned_at`, `reporting_ban_reason` (texte libre de l'admin) | Désactivation, retrait du droit de signaler | IL | Durée du compte ; effacées à la suppression | Admin |
| Double authentification (admins) | `users.totp_secret_encrypted` (AES-GCM), `totp_enabled_at`, `admin_recovery_codes.code_hash` | Sécurité de l'administration | IL, sécurité | Jusqu'à la réinitialisation ou la suppression | Admin concerné |
| Appareils de notification | `device_tokens.token`, `platform`, `app_version`, `language`, `install_id`, `session_id`, `last_seen_at` | Envoi des notifications push | Contrat, consentement (permission) | Lié à la session : supprimé à la déconnexion, à la révocation, au changement de mot de passe, à `DeviceNotRegistered` ; 90 jours sans réenregistrement ; supprimé avec le compte | Système (worker) ; la personne (copie, jeton tronqué aux 6 derniers caractères) |
| Préférences de notification | `notification_opt_outs` | Exécution du service | Contrat | Durée du compte | La personne |
| Boîte de réception | `notifications` (type, `data` : identifiants de station et de produit, décision) | Historique des notifications | Contrat | 30 jours ; supprimée avec le compte | La personne |
| Favoris et alertes suivies | `favorites`, `favorite_alerts` | Stations favorites, alertes « de retour en stock » | Contrat | Durée du compte ; supprimés avec le compte | La personne |
| Journal des alertes envoyées | `back_in_stock_alerts` | Limites de fréquence et heures calmes | IL | 30 jours (sauf alertes encore en attente) ; supprimé avec le compte | Système |
| Signalements | `reports.reporter_id`, `reason`, `product_id`, `comment` (300 caractères), `status`, `resolution_note`, `resolved_by` | Modération, fiabilité des stations | IL | Auteur remplacé par un pseudonyme (`reporter_pseudonym`, HMAC) à 90 jours ou à la suppression du compte ; signalement supprimé à 12 mois | Admin (auteur visible jusqu'à la pseudonymisation) ; **jamais le gérant** (ni auteur ni commentaire) ; exports admin : auteur pseudonymisé |
| Seuils de signalements | `station_report_flags` (nombre d'auteurs, pas leur identité) | Badges et exclusion | IL | Durée de la station | Public (badge), admin |
| Station | `stations.name`, `brand`, `ifu`, `rccm`, `address`, `city`, `phone`, `location`, `manager_id`, statut et motifs | Annuaire des stations, vérification du gérant | Contrat, IL | Durée de la station. À la suppression du compte du gérant : station suspendue, `manager_id` effacé, `manager_deleted_at` posé. **Aucune durée fixée ensuite** (écart E5) | Public (nom, marque, adresse, ville, position, horaires, stocks) ; admin (tout) ; gérant |
| Justificatif (IFU, RCCM) | `stations.document_*` et fichier chiffré `stations/<station>/<uuid>.bin` (enveloppe AES-256-GCM) | Vérifier que la station existe et que le gérant la représente | IL [obligation à confirmer] | Tant que la station est active ; 6 mois après un refus sans renvoi ; 12 mois après la suppression du compte du gérant (purge `station_documents`) | Admin (visionneuse), gérant (copie de ses données) |
| Contrôle de position à l'épinglage | `stations.location_flag_distance_m`, `location_flag_accuracy_m` ; `station_location_requests.device_distance_m`, `device_accuracy_m`, `requested_by` | Vraisemblance de l'épingle (D13) ; la position du téléphone n'est jamais stockée | IL | Station : sa durée. Demandes de déplacement : **aucune purge** (écart E6) | Admin |
| Horaires et fermetures | `station_opening_hours`, `station_closures.created_by`, `reason` | Exécution du service | Contrat | Durée de la station | Public (horaires), gérant, admin |
| Historique des stocks | `stock_history.changed_by`, quantités, source | Fiabilité, statistiques | IL | 12 mois, puis agrégé par jour dans `stock_history_daily`, **sans l'auteur** | Admin, gérant (copie) |
| Rappels de stock | `station_reminders` (compteurs par station) | Rappels aux gérants | Contrat | Durée de la station | Système |
| Alertes de modération | `admin_alerts` (station, motif, `resolved_by`, résolution) | Modération | IL | 12 mois après la résolution | Admin |
| Demandes d'exercice des droits | `data_requests` (`user_id`, type, `details`, `response_note`, `handled_by`, `verified_at`, échéance) | Traiter et prouver le traitement des demandes | Obligation | 3 ans après la clôture | Admin ; la personne (suivi dans l'app) |
| Copie des données (« Télécharger mes données ») | `personal_exports` et fichier chiffré `personal-exports/<id>.json.bin` | Droit d'accès | Obligation | 24 heures après la génération (purge toutes les 15 min) ; supprimée avec le compte | **La personne seule** (lien signé de 15 min + sa session) ; l'admin ne voit jamais le contenu |
| Exports d'administration | `exports` et fichiers chiffrés `exports/…` | Pilotage, conformité | IL | Fichiers : 24 heures ; métadonnées : 12 mois | Admin. Contenu : jamais d'email ni la liste des utilisateurs ; auteurs pseudonymisés |
| Journal d'audit | `audit_logs` (`actor_id`, rôle, action, entité, `metadata`, `request_id`) | Sécurité, responsabilité | IL | 12 mois | Admin (lecture seule, ajout seul) ; la personne (ses entrées, dans sa copie). `metadata` ne contient ni email ni texte libre de la personne |
| Statistiques de recherche | `search_stats`, `search_stats_daily`, `search_stats_totals` (cellule H3 res 7 ≈ 5 km², heure, produit, compteurs) | Pénuries | IL | Sans limite : anonymes ; affichées et exportées seulement au-delà de 5 recherches par cellule | Admin |
| Fraîcheur des stocks | `stock_freshness_stats` | Fiabilité | IL | Sans limite (aucune donnée personnelle) | Admin |

## 2. Redis (données éphémères, chiffrées ou en empreintes)

| Clé | Contenu | Durée de vie |
|---|---|---|
| `auth:sess:<id>`, `auth:rt:<empreinte>`, `auth:user:<uid>:sess` | Session : identifiant du compte, rôle, client, user agent (version de l'app, système, modèle d'appareil), dates ; empreinte du refresh token | 30 jours glissants (12 h pour un admin) ; supprimées à la déconnexion et à la révocation |
| `auth:mfa:<jeton>`, `auth:totp:last:<uid>` | Défi 2FA admin, dernier pas TOTP accepté (anti-rejeu) | 5 minutes ; durée d'un pas TOTP |
| `otp:<usage>:<uid>`, `otp:cooldown:…` | Empreinte HMAC du code à 6 chiffres (vérification de l'email, mot de passe oublié) | 15 minutes ; détruit après usage ou 5 échecs |
| `rl:{ip:…}`, `rl:{u:…}`, `rl:{i:…}`, connexion par email | Compteurs de limitation : empreinte SHA-256 tronquée de l'IP, du compte ou de l'installation ; email en HMAC à clé | De 1 minute à 1 heure (fenêtres) |
| `privacy:code:<id>`, `privacy:code:attempts:<id>` | Empreinte HMAC du code de confirmation d'une demande reçue par email, essais | 7 jours ; 5 essais |
| `stats:search:<heure>` | Compteurs anonymes (cellule, produit) | Jusqu'au vidage en base (5 minutes) |
| `search:v1:…`, `search:gen:…` | Cache des résultats par cellule et produit (stations, sans utilisateur) | Quelques minutes ; invalidé à chaque changement |
| Files asynq | `email:send` (charge utile **chiffrée** : ni adresse ni code en clair), `push:send` (identifiants de notifications), `privacy:export`, `export:generate` (identifiants) | Jusqu'au traitement ; tâches archivées après échec : 90 jours au plus, sans donnée en clair |

## 3. Journaux applicatifs (stdout de l'API et du worker)

Champs relevés dans le code : `request_id`, méthode, route, chemin, requête (seuls `product_id`, `station_id`, `status`, `limit` et `needs_review` en clair ; toute autre valeur, dont `lat`, `lng` et le texte de recherche, masquée), statut, durée, `user_id` (UUID), `station_id`, `export_id`, `session_id` (réutilisation d'un refresh token), sujet de l'email envoyé, code d'erreur SMTP ou Expo, compteurs des purges. **Jamais** : adresse IP, position, email, token push, texte de notification, code à 6 chiffres, mot de passe. Conservation : 30 jours, chez l'hébergeur (choisi à l'étape 10C).

## 4. Fichiers

| Fichier | Emplacement | Chiffrement | Conservation |
|---|---|---|---|
| Justificatifs des gérants | `DOCUMENTS_STORAGE_DIR/stations/…` | Enveloppe AES-256-GCM (clé par fichier, enveloppée par `DOCUMENTS_ENCRYPTION_KEY`) | Voir le justificatif, section 1 |
| Copies « Mes données » | `DOCUMENTS_STORAGE_DIR/personal-exports/…` | Idem | 24 heures |
| Exports d'administration | `DOCUMENTS_STORAGE_DIR/exports/…` | Idem | 24 heures |
| Sauvegardes de la base et des fichiers | Hébergeur (10C) | À définir (10C) | Rotation à définir : une donnée purgée disparaît des sauvegardes à l'expiration de la dernière qui la contient |

## 5. Sur les téléphones et dans le navigateur

| Donnée | Emplacement | Conservation |
|---|---|---|
| Refresh token | SecureStore (Keystore Android, trousseau iOS) | Jusqu'à la déconnexion |
| Identifiant d'installation (UUID aléatoire) | MMKV `gostation` | Jusqu'à la désinstallation |
| Préférences, espace mémorisé, autorisation de notification demandée, réponses de notification traitées | MMKV `gostation` | Jusqu'à la désinstallation ou la déconnexion |
| Cache des données publiques (catalogue, fiches de stations) | MMKV (préfixe `public`) | 7 jours ; jamais la position, ni la recherche, ni les données du compte (test `src/test/privacy.test.ts`) |
| Brouillon d'inscription d'un gérant (champs texte) | MMKV `gostation-drafts` chiffré (clé dans SecureStore) | Effacé à l'envoi ; jamais le mot de passe ni le justificatif |
| Brouillon de saisie des stocks | MMKV | Jusqu'à l'envoi |
| Copie « Mes données » | Cache de l'app, le temps du partage | Supprimée dès la fermeture de la feuille de partage |
| Admin web : indicateur de session et date du dernier renouvellement, thème, colonnes affichées, barre latérale | `localStorage` (le jeton CSRF reste en mémoire et en cookie ; la session en cookie HttpOnly) | Indicateur effacé à la déconnexion ; préférences jusqu'à leur effacement |

## 6. Sous-traitants et transferts hors du Bénin

| Destinataire | Rôle | Données | Pays | Statut |
|---|---|---|---|---|
| Expo (650 Industries, Inc.) | Service de push Expo (`exp.host`), mises à jour de l'app (`u.expo.dev`), builds EAS | Jeton push, contenu technique des notifications (iOS : titre et texte ; Android : type et identifiants), adresse IP ; code de l'app (builds) | États-Unis | Sous-traitant ; transfert hors du Bénin à encadrer |
| Google (Firebase Cloud Messaging) | Livraison des push Android | Jeton FCM, message de données | États-Unis et autres | Sous-traitant (via Expo) ; transfert à encadrer |
| OpenFreeMap | Tuiles des fonds de carte (app et admin) | Adresse IP, zones de carte affichées, user agent | À vérifier | Destinataire technique ; pas de contrat à ce jour (question au juriste) |
| Fournisseur SMTP | Envoi des emails | Adresse email, prénom, contenu (codes, réponses aux demandes) | Choisi à l'étape 10C | Sous-traitant |
| Hébergeur | Serveurs, base, fichiers, sauvegardes, journaux | Toutes les données | Choisi à l'étape 10C | Sous-traitant |
| OSRM | Calcul d'itinéraire | Position de départ et d'arrivée | **Auto-hébergé** : aucun transfert | — |

Aucun outil d'analyse d'audience, de publicité ni de suivi des plantages n'est intégré.

## 7. Écarts constatés (recherche dans le code)

| # | Constat | Risque | Proposition |
|---|---|---|---|
| E1 | L'empreinte d'IP des limiteurs (`rl:{ip:…}`) est un SHA-256 tronqué **sans clé** : l'espace IPv4 se parcourt en quelques secondes, l'IP est donc retrouvable par qui lit Redis | Faible (Redis privé, TTL ≤ 1 h) | HMAC avec une sous-clé HKDF dédiée (comme l'email de connexion) : 10B |
| E2 | `user_id` (UUID) figure dans les journaux applicatifs | Pseudonyme, utile au support ; journaux gardés 30 jours | À valider par le juriste ; sinon HMAC du `user_id` |
| E3 | Le commentaire libre d'un signalement est conservé 12 mois après la pseudonymisation de l'auteur | La personne peut s'y être identifiée | Proposer l'effacement du commentaire à 90 jours avec l'auteur (question au juriste) |
| E4 | Les comptes désactivés par un admin ne sont pas concernés par la purge d'inactivité | Conservation sans limite d'un compte inutilisable | Durée propre aux comptes désactivés (question au juriste) |
| E5 | La station d'un gérant supprimé (nom, IFU, RCCM, adresse, téléphone) reste sans durée ; seul le justificatif est purgé à 12 mois | Le téléphone peut être celui du gérant | Durée de conservation de la station suspendue (question au juriste) |
| E6 | Les demandes de déplacement d'épingle (`station_location_requests`) n'ont pas de purge | Faible (distances, auteur) | Règle de 12 mois après décision : 10B |
| E7 | Les tuiles OpenFreeMap révèlent l'adresse IP et la zone affichée à un tiers sans contrat | Indication de la position approximative | Contrat, ou tuiles auto-hébergées (10C) |
| E8 | Corrigé en 10A : l'anonymisation laissait sur la ligne du compte les motifs libres de désactivation et de retrait du droit de signaler (et échouait pour un compte désactivé) | — | `AnonymizeUser` les efface (`TestDeletionOfDisabledAccount`) |

Aucune autre donnée personnelle collectée ou journalisée hors de cet inventaire n'a été trouvée.
