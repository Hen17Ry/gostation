# Google Play — formulaire « Sécurité des données »

> **PROJET — à faire valider par un juriste.** Réponses proposées pour la Play Console (application `bj.gostation.app`), établies à partir de l'[inventaire](inventaire-donnees.md). Les intitulés suivent ceux de la Play Console ; à revoir à chaque version qui change la collecte.

## 1. Collecte et partage

| Question | Réponse proposée |
|---|---|
| L'application collecte-t-elle ou partage-t-elle des types de données requis ? | Oui |
| Toutes les données collectées sont-elles chiffrées en transit ? | Oui (HTTPS obligatoire en production, 10C) |
| Les utilisateurs peuvent-ils demander la suppression de leurs données ? | Oui : dans l'app (Compte › Mes données › Supprimer mon compte) et par une URL web [À COMPLÉTER : page de suppression hébergée, exigée par Google Play] |
| Partage avec des tiers | Non : Expo et Google (notifications) agissent comme prestataires pour notre compte, ce que Play ne compte pas comme un partage |

## 2. Types de données

| Catégorie Play | Type | Collecté | Éphémère | Obligatoire | Finalités Play |
|---|---|---|---|---|---|
| Position | Position exacte | Oui | **Oui** (traitée en mémoire, jamais stockée) | Facultative (choix d'un lieu sur la carte) | Fonctionnalités de l'application |
| Position | Position approximative | Oui | Oui | Facultative | Fonctionnalités de l'application |
| Informations personnelles | Nom | Oui | Non | Obligatoire avec un compte | Gestion du compte |
| Informations personnelles | Adresse e-mail | Oui | Non | Obligatoire avec un compte | Gestion du compte, communications du développeur |
| Informations personnelles | Numéro de téléphone | Oui (téléphone de la station, gérants) | Non | Obligatoire pour un gérant | Fonctionnalités de l'application |
| Informations personnelles | Autres informations (IFU, RCCM) | Oui (gérants) | Non | Obligatoire pour un gérant | Prévention de la fraude, sécurité et conformité |
| Photos et vidéos / Fichiers et documents | Justificatif (photo ou PDF) | Oui (gérants) | Non | Obligatoire pour un gérant | Prévention de la fraude, sécurité et conformité |
| Activité dans l'application | Interactions (favoris, alertes, signalements) | Oui | Non | Facultative | Fonctionnalités de l'application |
| Activité dans l'application | Autre contenu généré (commentaire d'un signalement) | Oui | Non | Facultative | Fonctionnalités de l'application |
| Identifiants de l'appareil ou autres | Identifiant d'installation, jeton de notification | Oui | Non | Identifiant : oui ; jeton : si les notifications sont autorisées | Fonctionnalités de l'application, sécurité (quotas) |
| Infos et performances de l'appli | Journaux de plantage | Oui, si le suivi des plantages est activé (D90) | Non (serveur GlitchTip auto-hébergé) | Obligatoire (pas de réglage dans l'app) | Analyses (correction des erreurs) ; données traitées de façon éphémère : non, 30 jours |
| Historique de navigation, contacts, messages, santé, finances, audio | — | Non | — | — | — |

Ni publicité, ni analyse d'audience, ni vente de données.

## 3. Autres déclarations Play liées

- **Politique de confidentialité** : URL publique du HTML généré (`make legal-html`, hébergé en 10C).
- **Suppression de compte** : URL de la page web de demande de suppression (10B ou 10C).
- **Autorisation de position** : premier plan seulement (`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`), aucune position en arrière-plan.
- **Appareil photo** : prise de vue du justificatif d'un gérant.
- **Notifications** (Android 13+) : demandées au moment utile, jamais au premier lancement (D70).
