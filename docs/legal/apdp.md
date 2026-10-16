# Formalités auprès de l'APDP — GoStation

> **PROJET — à faire valider par un juriste.** Note préparatoire : elle recense ce que GoStation devra vraisemblablement accomplir auprès de l'Autorité de protection des données à caractère personnel (APDP) du Bénin, au titre du Code du numérique (loi n° 2017-20 du 20 avril 2018, Livre V). Les formalités exactes, leurs formulaires et leurs délais sont à confirmer par le juriste ; aucune n'a été accomplie à ce jour.

## 1. Ce qui est prêt

| Pièce | Où |
|---|---|
| Description des traitements (finalités, bases légales, données, destinataires, durées) | [registre-traitements.md](registre-traitements.md) |
| Inventaire détaillé, à partir du code | [inventaire-donnees.md](inventaire-donnees.md) |
| Information des personnes | [politique-confidentialite.md](politique-confidentialite.md), affichée dans l'app (version 1.0) et en HTML (`make legal-html`) |
| Conditions d'utilisation | [cgu.md](cgu.md) |
| Exercice des droits | App : Compte › Mes données (copie en 24 h, demandes, suppression) ; administration : section « Demandes de données » (échéance de 30 jours, alerte à 7 jours, actions auditées) |
| Mesures de sécurité | Registre, en-tête ; ARCHITECTURE §6 et §8 |

## 2. Formalités à confirmer

| # | Formalité probable | Pourquoi GoStation est concerné | À fournir |
|---|---|---|---|
| F1 | Déclaration (ou demande d'avis ou d'autorisation) des traitements T1 à T9 avant la mise en service | Traitement de données personnelles d'utilisateurs au Bénin | Registre, mesures de sécurité, coordonnées du responsable |
| F2 | Régime propre au numéro d'identification fiscale (IFU) et au justificatif des gérants | Collecte d'un identifiant officiel et d'un document le portant (T5) | Finalité de vérification, accès restreint, chiffrement, durées |
| F3 | Autorisation ou encadrement des transferts hors du Bénin | Expo et Google (États-Unis) ; hébergeur et service d'emails selon le choix de 10C ; OpenFreeMap | Liste des destinataires, pays, garanties contractuelles |
| F4 | Désignation éventuelle d'un correspondant ou délégué à la protection des données | Selon le seuil ou la nature des traitements | Nom, coordonnées |
| F5 | Procédure de notification des violations de données | Obligation probable de notifier l'APDP (et les personnes) | Procédure interne, délai, modèle de notification (10C) |

## 3. Informations attendues du responsable

- Raison sociale, forme juridique, adresse, RCCM, IFU, représentant légal.
- Adresse de contact vie privée (`PRIVACY_CONTACT_EMAIL`), communiquée dans les emails des demandes de données.
- Hébergeur et service d'envoi d'emails retenus (10C), avec leurs pays et leurs garanties.
- Durée de rotation des sauvegardes (10C).

## 4. Calendrier proposé

1. Réponses du juriste aux [questions](questions-juriste.md) ; ajustement des durées (`RETENTION_*`) et des textes (version 1.1 si nécessaire, réacceptation dans l'app).
2. Choix de l'hébergeur et du service d'emails (10C), contrats de sous-traitance.
3. Dépôt des formalités F1 à F4, avant l'ouverture au public.
4. Publication des textes validés (HTML hébergé) et lien dans la fiche Google Play.
