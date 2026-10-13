# Captures de l'app mobile

Chaque écran en clair (`-light`) et en sombre (`-dark`), build release, 1080 × 2400. Relevé du
2026-10-13 sur l'émulateur Android 16 (le téléphone n'était pas branché) : à refaire sur un
téléphone dès qu'il l'est.

| Plage   | Contenu                                                                            | Régénération                                 |
| ------- | ---------------------------------------------------------------------------------- | -------------------------------------------- |
| 00      | Écran de démarrage                                                                 | `npm run screenshots` (`SPLASH_ONLY=1` seul) |
| 01 à 26 | Parcours principal : accueil, carte, résultats, fiche, itinéraire, compte, favoris | `npm run screenshots`                        |
| 05      | Recherche en cours (ondes de rayon)                                                | `npm run states` (`STEPS=radius`)            |
| 27 à 45 | États mis en scène sur la pile isolée                                              | `npm run states` (`STEPS=…`, voir le script) |
| 46      | Vitrine `/design` (dev build seulement)                                            | à la main : Compte → Design system           |

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
