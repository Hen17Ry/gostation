# Registre des traitements — GoStation

> **PROJET — à faire valider par un juriste.** Registre tenu par le responsable du traitement (Code du numérique, Livre V ; forme exacte attendue par l'APDP à confirmer). Détail des données, emplacements et durées : [inventaire-donnees.md](inventaire-donnees.md). Version 1.0 du 16 octobre 2026.

**Responsable du traitement** : [À COMPLÉTER : raison sociale, adresse, RCCM, IFU, représentant légal].
**Contact vie privée** : [À COMPLÉTER : adresse email ; `PRIVACY_CONTACT_EMAIL`].
**Délégué à la protection des données** : [À COMPLÉTER, si désigné].

Mesures de sécurité communes à tous les traitements : HTTPS, mots de passe argon2id, justificatifs et copies chiffrés (AES-256-GCM, clés hors base), secrets hors dépôt, sessions révocables, 2FA obligatoire pour l'administration, limitation des requêtes, journal d'audit en ajout seul, journaux sans IP, position ni token push, contrôle d'accès par rôle à chaque requête, sauvegardes chiffrées (10C).

## T1. Comptes et authentification

| Rubrique | Contenu |
|---|---|
| Finalité | Créer et gérer un compte, se connecter, vérifier l'adresse email, réinitialiser le mot de passe, gérer ses sessions |
| Base légale | Contrat |
| Personnes | Utilisateurs, gérants, administrateurs |
| Données | Email, prénom, nom, empreinte du mot de passe, rôle, statut, dates de connexion et d'activité, version de la politique acceptée ; sessions (client, user agent) ; codes à 6 chiffres (empreintes) ; 2FA des admins |
| Destinataires | Équipe GoStation (support) ; hébergeur, service d'envoi d'emails |
| Transferts hors Bénin | Selon l'hébergeur et le service d'emails (10C) |
| Conservation | Durée du compte ; anonymisation immédiate à la suppression ; compte inactif supprimé à 24 mois (prévenu à 23) ; sessions 30 jours glissants ; codes 15 minutes |

## T2. Recherche de stations et itinéraire

| Rubrique | Contenu |
|---|---|
| Finalité | Trouver les stations proches ayant un produit, calculer l'itinéraire |
| Base légale | Contrat ; consentement (permission de position du téléphone) |
| Personnes | Utilisateurs, avec ou sans compte |
| Données | Position (en mémoire seulement, jamais conservée), identifiant d'installation (quotas), empreintes d'IP ou d'installation dans les limiteurs (1 h au plus) |
| Destinataires | Aucun : calcul d'itinéraire auto-hébergé (OSRM). Fonds de carte : OpenFreeMap reçoit l'IP et la zone affichée |
| Transferts hors Bénin | OpenFreeMap (à vérifier) |
| Conservation | Position : aucune ; limiteurs : 1 heure au plus |

## T3. Statistiques de recherche et de fiabilité

| Rubrique | Contenu |
|---|---|
| Finalité | Repérer les pénuries par zone, mesurer la fraîcheur des stocks |
| Base légale | Intérêt légitime |
| Personnes | Aucune identifiable |
| Données | Compteurs anonymes par cellule H3 (≈ 5 km²), heure et produit ; seuil k ≥ 5 à l'affichage |
| Destinataires | Administrateurs |
| Conservation | Sans limite (données anonymes) |

## T4. Favoris, alertes et notifications

| Rubrique | Contenu |
|---|---|
| Finalité | Garder des stations favorites, prévenir du retour d'un produit, rappeler aux gérants de mettre à jour leurs stocks, informer des décisions sur une station |
| Base légale | Contrat ; consentement (permission de notification) |
| Personnes | Utilisateurs avec compte, gérants |
| Données | Favoris, alertes suivies, préférences, boîte de réception, jeton push, plateforme, langue, version de l'app |
| Destinataires | Expo, Google Firebase Cloud Messaging |
| Transferts hors Bénin | États-Unis (Expo, Google) |
| Conservation | Favoris et préférences : durée du compte ; boîte de réception et journal des alertes : 30 jours ; jeton push : session, 90 jours sans utilisation |

## T5. Gestion des stations par leurs gérants et vérification

| Rubrique | Contenu |
|---|---|
| Finalité | Inscrire une station, vérifier le gérant et la station, publier ses horaires, produits et stocks |
| Base légale | Contrat ; intérêt légitime (fiabilité de l'annuaire) [obligation éventuelle à confirmer pour l'IFU] |
| Personnes | Gérants |
| Données | Station (nom, marque, IFU, RCCM, adresse, ville, téléphone, position), justificatif IFU ou RCCM, distance et précision GPS à l'épinglage, historique des stocks |
| Destinataires | Public (fiche de station : nom, marque, adresse, ville, position, horaires, stocks ; ni IFU, ni RCCM, ni téléphone) ; administrateurs |
| Conservation | Station : durée de son activité [à fixer après suppression du gérant] ; justificatif : station active, 6 mois après un refus, 12 mois après la suppression du gérant ; historique des stocks : 12 mois puis agrégé sans auteur |

## T6. Signalements et modération

| Rubrique | Contenu |
|---|---|
| Finalité | Recueillir les signalements des utilisateurs, modérer, retirer le droit de signaler en cas d'abus, alerter l'administration |
| Base légale | Intérêt légitime |
| Personnes | Utilisateurs avec compte (auteurs) ; gérants (stations signalées) |
| Données | Motif, produit, commentaire, auteur (pseudonymisé à 90 jours), décision, alertes de modération ; position de l'auteur contrôlée en mémoire (2 km), jamais conservée |
| Destinataires | Administrateurs ; le gérant ne voit que les motifs et compteurs |
| Conservation | Auteur : 90 jours puis pseudonyme ; signalement : 12 mois ; alertes : 12 mois après résolution |

## T7. Administration, audit et exports

| Rubrique | Contenu |
|---|---|
| Finalité | Piloter le service, tracer les actions sensibles, produire des exports |
| Base légale | Intérêt légitime |
| Personnes | Administrateurs (acteurs) ; personnes visées par les actions |
| Données | Journal d'audit (acteur, action, entité, métadonnées sans email ni texte libre), exports CSV ou JSON (auteurs pseudonymisés, jamais d'email) |
| Destinataires | Administrateurs |
| Conservation | Audit : 12 mois ; fichiers d'export : 24 heures ; métadonnées : 12 mois |

## T8. Exercice des droits des personnes

| Rubrique | Contenu |
|---|---|
| Finalité | Recevoir, vérifier, traiter et prouver les demandes d'accès, de rectification, d'opposition, de suppression ; fournir une copie des données |
| Base légale | Obligation légale |
| Personnes | Toute personne ayant un compte |
| Données | Demande (type, précisions, échéance, réponse, admin en charge, date de vérification), code de confirmation (empreinte, 7 jours), copie des données (24 heures) |
| Destinataires | Administrateurs (jamais le contenu de la copie) ; service d'envoi d'emails |
| Conservation | Demandes : 3 ans après clôture ; copies : 24 heures |

## T9. Journaux techniques et sécurité

| Rubrique | Contenu |
|---|---|
| Finalité | Diagnostiquer les incidents, détecter les abus |
| Base légale | Intérêt légitime |
| Données | Identifiant de requête, route, statut, durée, identifiant du compte (UUID) ; jamais IP, position, email, token ni contenu de notification |
| Destinataires | Équipe technique ; hébergeur |
| Conservation | 30 jours (10C) |
