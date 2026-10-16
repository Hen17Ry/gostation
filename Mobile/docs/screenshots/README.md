# Captures de l'app mobile

Chaque écran en clair (`-light`) et en sombre (`-dark`), build release, police à 100 %, barre
d'état de démonstration. Parcours principal (01 à 26) : Galaxy S10 (Android 12, 1080 × 2280), le
2026-10-13 ; écran de démarrage (00) et états mis en scène (05, 27 à 45) : émulateur Android 16
(1080 × 2400), même jour (sur le S10, l'enregistrement d'écran ne capte pas l'écran de démarrage).

| Plage   | Contenu                                                                            | Régénération                                 |
| ------- | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| 00      | Écran de démarrage                                                                 | `npm run screenshots` (`SPLASH_ONLY=1` seul) |
| 01 à 26 | Parcours principal : accueil, carte, résultats, fiche, itinéraire, compte, favoris | `npm run screenshots`                        |
| 05      | Recherche en cours (ondes de rayon)                                                | `npm run states` (`STEPS=radius`)            |
| 27 à 45 | États mis en scène sur la pile isolée                                              | `npm run states` (`STEPS=…`, voir le script) |
| 46      | Vitrine `/design` (dev build seulement)                                            | à la main : Compte → Design system           |
| 50 à 69 | Espace gérant (Galaxy S10) : inscription, statuts, configuration, stocks, station  | `PARTS=manager npm run screenshots`          |
| 70 à 74 | Notifications (9C) : explication des rappels, autorisation refusée, push           | voir « Notifications » ci-dessous            |

## États (27 à 45)

| Capture                  | État                                                                      |
| ------------------------ | ------------------------------------------------------------------------- |
| 27-no-station            | aucune station n'a le produit en stock                                    |
| 28-closed-reported       | seule station en stock fermée aujourd'hui et signalée (repli « fermées ») |
| 29-station-closed        | fiche de cette station : « Fermée · rouvre … »                            |
| 30-location-denied       | localisation refusée : choix d'un point sur la carte                      |
| 31-manual-point-results  | résultats depuis le point choisi                                          |
| 32-offline-results       | hors connexion : derniers résultats de la session conservés               |
| 33-offline-search        | hors connexion : panneau de recherche, bouton désactivé                   |
| 34-alert-enabled         | favori + alerte « de retour en stock » sur le gasoil (à 0)                |
| 35-inbox-back-in-stock   | boîte de réception après le réassort du gérant                            |
| 36-station-back-in-stock | fiche ouverte depuis la notification                                      |
| 37-change-password       | changement de mot de passe                                                |
| 38-forgot-password       | mot de passe oublié                                                       |
| 39-reset-password        | nouveau mot de passe (code reçu)                                          |
| 40-delete-account        | suppression du compte                                                     |
| 41-navigation-rerouted   | guidage vocal, trajet simulé à l'écart : itinéraire recalculé             |
| 42-navigation-arrived    | arrivée                                                                   |
| 43-approximate           | OSRM coupé : distances estimées (vol d'oiseau)                            |
| 44-route-unavailable     | itinéraire indisponible (503) : ligne droite                              |
| 45-external-app          | « Ouvrir dans une autre app »                                             |

## Espace gérant (50 à 69)

Pile E2E et son pilotage (`e2efixtures serve`) : dossiers approuvés, refusés ou suspendus par
script, saisie concurrente pour le conflit. Le justificatif de test est déposé dans
Téléchargements le temps des captures ; le sélecteur de fichiers n'est jamais capturé (il montre
les fichiers récents du téléphone).

| Capture                         | État                                                                    |
| ------------------------------- | ----------------------------------------------------------------------- |
| 50-manager-sign-up-account      | inscription, étape 1 : compte et politique acceptée                     |
| 51-manager-sign-up-station      | étape 2 : station, IFU en cours de saisie (8/13)                        |
| 52-manager-sign-up-document     | étape 3 : justificatif PDF choisi, aperçu                               |
| 53-manager-status-pending       | dossier en vérification : ce qui va se passer, délai indicatif          |
| 54-manager-setup-checklist      | station approuvée : checklist (0 sur 4), aucun produit déclaré          |
| 55-manager-location             | épinglage : épingle fixe au centre, avertissement                       |
| 56-manager-hours                | horaires : lundi copié sur toute la semaine                             |
| 57-manager-products             | produits vendus : gaz 10 kg et essence                                  |
| 58-manager-stocks-edited        | saisie en cours : 12 bouteilles, 6 000 L (produits modifiés en avant)   |
| 59-manager-stocks-summary       | récapitulatif avant l'envoi                                             |
| 60-manager-stocks               | stocks envoyés, « Rien n'a changé »                                     |
| 61-manager-stocks-offline       | hors connexion : saisie gardée, envoi bloqué                            |
| 62-manager-stocks-back-online   | retour du réseau : envoi proposé                                        |
| 63-manager-stocks-conflict      | 412 : avant, maintenant, votre saisie                                   |
| 64-manager-station              | Ma station : configuration et profil                                    |
| 65-manager-status-suspended     | station suspendue : motif et contact                                    |
| 66-manager-reports              | signalements : station exclue de la recherche (5 « position incorrecte ») |
| 67-manager-status-rejected      | dossier refusé : motif, correction, nouveau justificatif                |
| 68-manager-edit                 | correction des informations                                             |
| 69-manager-resubmit             | nouveau justificatif choisi                                             |

## Notifications (70 à 74)

Build `preview` (EAS), le 2026-10-16, à la main (70 aussi par `PARTS=manager npm run screenshots`) :
70 à 73 sur l'émulateur Android 16 (autorisation POST_NOTIFICATIONS), 74 sur le Galaxy S10. Le
volet du système (73) est recadré sur la seule notification de GoStation : jamais celles des autres
applications.

| Capture                    | État                                                                        |
| -------------------------- | --------------------------------------------------------------------------- |
| 70-manager-reminders-intro | explication des rappels, juste après la validation de la station            |
| 71-manager-push-denied     | autorisation refusée : bandeau discret dans Stocks, lien vers les réglages  |
| 72-favorites-push-denied   | autorisation refusée après l'activation d'une alerte : bandeau dans Favoris |
| 73-reminder-notification   | rappel dans le volet, avec « Mettre à jour » et « Rien n'a changé »         |
| 74-push-toast              | push reçu app ouverte : toast, sans notification du système                 |
