---
title: Politique de confidentialité
version: 1.0
updated: 16 octobre 2026
---

# Politique de confidentialité de GoStation

> **PROJET — à faire valider par un juriste.** Ce texte n'est pas encore en vigueur : les mentions entre crochets sont à compléter avant la mise en service.

GoStation vous aide à trouver, près de vous, une station qui a du carburant ou du gaz. Cette politique explique quelles données nous utilisons, pourquoi, combien de temps nous les gardons et comment exercer vos droits. Nous avons conçu l'application pour collecter le moins de données possible.

## En bref

- **Votre position n'est jamais enregistrée.** Elle sert le temps d'une recherche, d'un itinéraire ou d'un signalement, puis elle est oubliée.
- **Vous pouvez chercher une station sans compte.** Un compte sert aux favoris, aux alertes et aux signalements.
- **Nous ne vendons aucune donnée** et nous n'affichons aucune publicité.
- **Vous gardez la main** : dans l'application, Compte › Mes données, vous téléchargez vos données, faites une demande ou supprimez votre compte.

## 1. Qui est responsable de vos données ?

Le responsable du traitement est [À COMPLÉTER : raison sociale, forme juridique, adresse du siège, numéro RCCM et IFU].

Pour toute question sur vos données : [À COMPLÉTER : adresse email dédiée à la vie privée], ou depuis l'application (Compte › Mes données › Faire une demande).

## 2. Quelles données utilisons-nous, et pourquoi ?

### Sans compte

- **Votre position**, si vous l'autorisez : pour trouver les stations proches et calculer l'itinéraire. Elle est envoyée à nos serveurs au moment de la recherche et n'y est jamais conservée.
- **Un identifiant d'installation**, tiré au hasard au premier lancement : il limite le nombre de recherches par appareil pour protéger le service. Il ne vous identifie pas et n'est pas lié à votre identité.
- **Vos recherches**, sous une forme anonyme : nous comptons les recherches par zone d'environ 5 km² et par heure, sans lien avec vous, pour repérer les pénuries.

### Avec un compte

- **Votre identité** : prénom, nom, adresse email, et votre mot de passe sous une forme chiffrée que personne ne peut relire.
- **Votre activité dans l'application** : stations favorites, alertes « de retour en stock », préférences et historique des notifications, signalements (motif, produit, commentaire), demandes concernant vos données.
- **Vos sessions et appareils** : type d'application, modèle d'appareil et dates de connexion ; pour les notifications, le jeton de notification de votre téléphone, sa plateforme et sa langue.
- **Les dates utiles** : création du compte, dernière connexion, dernière activité, acceptation de cette politique.

### Si vous gérez une station

- **La station** : nom, marque, IFU, RCCM, adresse, ville, téléphone, position de la station, horaires, produits vendus et stocks.
- **Le justificatif** fourni à l'inscription (attestation IFU ou RCCM) : il permet à notre équipe de vérifier que la station existe et que vous la représentez. Il est chiffré et seule l'équipe de vérification peut l'ouvrir.
- **L'historique des stocks** que vous saisissez, pour mesurer la fiabilité des informations.
- Quand vous placez l'épingle de la station, la position de votre téléphone sert à vérifier la cohérence ; seule la distance entre votre téléphone et l'épingle est conservée.

### Ce que nous ne conservons pas

- votre position ;
- la liste de vos recherches ;
- votre adresse IP : elle sert seulement, sous forme d'empreinte et pendant une heure au plus, à limiter les abus, et n'apparaît jamais dans nos journaux.

## 3. Sur quelle base utilisons-nous vos données ?

- **L'exécution du service que vous demandez** (conditions d'utilisation) : compte, recherche, itinéraire, favoris, alertes, notifications, espace gérant.
- **Notre intérêt légitime** à assurer un service fiable et sûr : vérification des stations, modération des signalements, sécurité des comptes, statistiques anonymes de pénurie.
- **Votre consentement**, donné au système de votre téléphone : position et notifications. Vous pouvez le retirer à tout moment dans les réglages du téléphone.
- [À COMPLÉTER après avis juridique : obligations légales applicables, par exemple en matière comptable ou de réquisition.]

## 4. Votre position

L'application ne demande votre position qu'au premier plan, jamais en arrière-plan. Vous pouvez refuser : vous choisissez alors un lieu sur la carte. La position est transmise de façon chiffrée, traitée en mémoire le temps de la réponse, et n'est écrite ni dans une base de données ni dans un journal.

Les fonds de carte sont fournis par OpenFreeMap : pour afficher la carte, votre téléphone lui demande les images de la zone affichée, ce qui lui révèle cette zone et l'adresse IP de votre connexion (voir la section 6).

## 5. Notifications

Les notifications (alertes « de retour en stock », rappels de stock pour les gérants, décisions sur une station) ne sont envoyées que si vous les autorisez dans le système. Pour les acheminer, nous enregistrons le jeton de notification de votre téléphone, lié à votre session : il est supprimé à la déconnexion, à la suppression du compte, ou après 90 jours sans utilisation.

Le contenu d'une notification passe par le service Expo puis, sur Android, par Google Firebase Cloud Messaging. Sur Android, ces messages ne contiennent ni titre ni texte : seulement le type de notification et des identifiants (station, produit), le texte étant composé sur votre téléphone. Sur iPhone, ils contiennent le titre et le texte de la notification. Le contenu est masqué sur l'écran verrouillé.

## 6. Qui reçoit vos données ?

Vos données ne sont accessibles qu'à l'équipe GoStation qui en a besoin (vérification des stations, modération, support), et à nos prestataires techniques, chacun pour sa mission :

| Prestataire | Rôle | Données concernées | Pays |
|---|---|---|---|
| Expo (650 Industries, Inc.) | Acheminement des notifications ; mises à jour de l'application | Jeton de notification, contenu technique des notifications ; adresse IP | États-Unis |
| Google (Firebase Cloud Messaging) | Livraison des notifications sur Android | Jeton de notification, contenu technique des notifications | États-Unis et autres pays |
| OpenFreeMap | Fonds de carte | Adresse IP, zones de carte affichées | [À COMPLÉTER] |
| [À COMPLÉTER : hébergeur, choisi avant la mise en service] | Hébergement des serveurs, de la base de données et des sauvegardes | Toutes les données décrites ici | [À COMPLÉTER] |
| [À COMPLÉTER : service d'envoi d'emails] | Envoi des emails (codes, confirmations, réponses) | Adresse email, prénom, contenu de l'email | [À COMPLÉTER] |

Certaines de ces données sont donc transférées hors du Bénin. [À COMPLÉTER après avis juridique : garanties encadrant ces transferts et formalités auprès de l'APDP.]

Nous ne communiquons pas vos données à d'autres tiers, sauf obligation légale. Les gérants ne voient jamais l'auteur d'un signalement ni son commentaire.

## 7. Combien de temps gardons-nous vos données ?

| Donnée | Durée |
|---|---|
| Position | Aucune conservation |
| Compte | Tant que vous l'utilisez. Sans aucune connexion pendant 24 mois, il est supprimé ; vous êtes prévenu par email 30 jours avant |
| Boîte de réception (notifications) | 30 jours |
| Jetons de notification | Jusqu'à la déconnexion, ou 90 jours sans utilisation |
| Sessions de connexion | 30 jours sans utilisation |
| Signalements | Votre nom en est retiré au bout de 90 jours (remplacé par un pseudonyme) ; le signalement est supprimé au bout de 12 mois |
| Justificatif d'un gérant | Tant que la station est active ; 6 mois après le refus d'un dossier non renvoyé ; 12 mois après la suppression du compte du gérant |
| Historique des stocks | 12 mois, puis regroupé par jour, sans lien avec le gérant |
| Journal de sécurité (actions sur les comptes et les stations) | 12 mois |
| Demandes concernant vos données | 3 ans après leur clôture, pour prouver qu'elles ont été traitées |
| Copie de vos données | 24 heures après sa préparation |
| Statistiques de recherche par zone | Sans limite : elles sont anonymes |

Les sauvegardes de nos serveurs suivent une rotation : une donnée supprimée en disparaît au plus tard [À COMPLÉTER : durée de rotation des sauvegardes] après sa suppression.

Ces durées sont proposées et restent à valider. [À COMPLÉTER après avis juridique.]

## 8. Sécurité

Les échanges avec nos serveurs sont chiffrés. Les mots de passe sont stockés sous une forme irréversible (argon2id), les justificatifs et les copies de données sont chiffrés, les codes envoyés par email expirent vite et ne servent qu'une fois, et l'équipe d'administration se connecte avec une double authentification. Nos journaux techniques ne contiennent ni position, ni adresse IP, ni contenu de notification.

## 9. Vos droits

Vous pouvez à tout moment :

- **accéder à vos données** et en obtenir une copie : Compte › Mes données › Télécharger mes données (fichier lisible, disponible 24 heures) ;
- **les faire rectifier** : Compte › Modifier le profil, ou par une demande ;
- **vous opposer** à un traitement fondé sur notre intérêt légitime ;
- **supprimer votre compte** : Compte › Mes données › Supprimer mon compte ;
- **faire toute autre demande** concernant vos données.

Depuis l'application, vous êtes déjà identifié. Si vous nous écrivez par email, nous envoyons un code à l'adresse de votre compte : nous traitons la demande une fois ce code communiqué, pour être sûrs qu'elle vient de vous. Nous répondons dans un délai de [À COMPLÉTER : délai légal, 30 jours proposés], et vous recevez un accusé de réception avec la référence de votre demande.

Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir l'Autorité de protection des données à caractère personnel (APDP) du Bénin : [À COMPLÉTER : coordonnées de l'APDP].

## 10. Enfants

GoStation ne s'adresse pas aux enfants. [À COMPLÉTER après avis juridique : âge minimum pour créer un compte.]

## 11. Modifications de cette politique

Si cette politique change, l'application vous présente la nouvelle version, que vous devez accepter pour continuer à utiliser votre compte. Chaque version porte un numéro et une date.

## 12. Nous contacter

[À COMPLÉTER : adresse email dédiée à la vie privée et adresse postale du responsable du traitement.]
