# Questions pour le juriste — GoStation

> **PROJET — à faire valider par un juriste.** Questions ouvertes à l'issue de l'étape 10A. Les durées proposées sont appliquées par défaut et réglables sans changer le code (`RETENTION_*`, `PRIVACY_*` dans `.env`). Contexte : [inventaire](inventaire-donnees.md), [registre](registre-traitements.md), [APDP](apdp.md).

## Cadre et formalités

1. Quelles formalités exactes accomplir auprès de l'APDP avant l'ouverture (déclaration, demande d'avis, autorisation), pour quels traitements, et avec quels formulaires ?
2. La collecte de l'IFU et du justificatif des gérants relève-t-elle d'un régime particulier (numéro d'identification officiel) ? Sur quelle base légale la fonder : intérêt légitime, obligation, contrat ?
3. Quelles garanties pour les transferts vers les États-Unis (Expo, Google Firebase Cloud Messaging) et, selon le choix de 10C, pour l'hébergeur et le service d'emails ? Une autorisation de l'APDP est-elle nécessaire ?
4. OpenFreeMap reçoit l'adresse IP et la zone de carte affichée, sans contrat : est-ce acceptable, ou faut-il héberger nos propres tuiles ?
5. Faut-il désigner un correspondant ou délégué à la protection des données ?
6. Quelle procédure et quel délai pour notifier une violation de données à l'APDP et aux personnes ?
7. Quelles coordonnées de l'APDP indiquer dans la politique, pour une réclamation ?

## Droits des personnes

8. Quel est le délai légal de réponse à une demande (30 jours proposés, `PRIVACY_REQUEST_DEADLINE`) ? Est-il prolongeable, et sous quelles conditions ?
9. La vérification d'identité retenue suffit-elle : demande authentifiée dans l'app ; demande par email confirmée par un code envoyé à l'adresse du compte (7 jours, 5 essais) ? Que faire d'une demande d'une personne sans compte ou qui n'a plus accès à son adresse ?
10. Le droit à la portabilité existe-t-il au Bénin ? La copie JSON lisible (24 heures) suffit-elle pour le droit d'accès ?
11. Âge minimum pour créer un compte, et faut-il le vérifier ?

## Durées de conservation (valeurs par défaut)

12. Compte inactif : avertissement à 23 mois, suppression à 24 mois. Adapté ?
13. Comptes désactivés par l'administration : aujourd'hui exclus de la purge d'inactivité. Quelle durée leur appliquer (écart E4) ?
14. Signalements : auteur pseudonymisé à 90 jours, suppression à 12 mois. Faut-il aussi effacer le commentaire libre à 90 jours (écart E3) ?
15. Justificatif : tant que la station est active ; 6 mois après un refus sans renvoi ; 12 mois après la suppression du compte du gérant. Adapté au regard d'éventuelles obligations de vérification ?
16. Station d'un gérant supprimé : nom, IFU, RCCM, adresse et téléphone sont gardés sans durée (station suspendue). Quelle durée retenir (écart E5) ?
17. Journal d'audit : 12 mois. Historique des stocks : 12 mois, puis agrégat quotidien sans auteur. Demandes de droits : 3 ans après clôture. Métadonnées d'exports et alertes de modération : 12 mois. Journaux techniques : 30 jours. Adapté ?
18. Sauvegardes : une donnée purgée y reste jusqu'à l'expiration de la dernière sauvegarde qui la contient. Quelle durée de rotation maximale ?
19. Les identifiants de compte (UUID) dans les journaux techniques sont-ils acceptables, ou faut-il les pseudonymiser (écart E2) ?

## Textes

20. La politique de confidentialité et les CGU (version 1.0, en français clair) conviennent-elles ? Quelles mentions obligatoires manquent (responsable, finalités, destinataires, transferts, durées, droits, réclamation) ?
21. Limites de responsabilité admissibles en droit béninois (stocks déclarés par les gérants, itinéraires estimés), tribunal compétent, médiation préalable ?
22. Une modification de la politique impose-t-elle toujours une réacceptation (l'app l'exige à chaque nouvelle version), ou une simple information suffit-elle pour un changement mineur ?
23. Faut-il un contrat ou des conditions particulières pour les gérants (engagements sur l'exactitude des stocks et de la position, suspension) ?
