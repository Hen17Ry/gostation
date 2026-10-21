// Généré par scripts/gen-legal.mts depuis docs/legal/*.md (npm run gen:legal) : ne pas modifier.
import type { LegalDocument } from './markdown'

export const privacyPolicy: LegalDocument = {
  meta: {
    title: 'Politique de confidentialité',
    version: '1.0',
    updated: '21 octobre 2026',
  },
  blocks: [
    {
      type: 'heading',
      level: 1,
      text: [
        {
          text: 'Politique de confidentialité de GoStation',
        },
      ],
    },
    {
      type: 'note',
      text: [
        {
          text: 'PROJET — à faire valider par un juriste.',
          bold: true,
        },
        {
          text: " Ce texte n'est pas encore en vigueur : les mentions entre crochets sont à compléter avant la mise en service.",
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "GoStation vous aide à trouver, près de vous, une station qui a du carburant ou du gaz. Cette politique explique quelles données nous utilisons, pourquoi, combien de temps nous les gardons et comment exercer vos droits. Nous avons conçu l'application pour collecter le moins de données possible.",
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: 'En bref',
        },
      ],
    },
    {
      type: 'list',
      ordered: false,
      items: [
        [
          {
            text: "Votre position n'est jamais enregistrée.",
            bold: true,
          },
          {
            text: " Elle sert le temps d'une recherche, d'un itinéraire ou d'un signalement, puis elle est oubliée.",
          },
        ],
        [
          {
            text: 'Vous pouvez chercher une station sans compte.',
            bold: true,
          },
          {
            text: ' Un compte sert aux favoris, aux alertes et aux signalements.',
          },
        ],
        [
          {
            text: 'Nous ne vendons aucune donnée',
            bold: true,
          },
          {
            text: " et nous n'affichons aucune publicité.",
          },
        ],
        [
          {
            text: 'Vous gardez la main',
            bold: true,
          },
          {
            text: " : dans l'application, Compte › Mes données, vous téléchargez vos données, faites une demande ou supprimez votre compte.",
          },
        ],
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '1. Qui est responsable de vos données ?',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: 'Le responsable du traitement est [À COMPLÉTER : raison sociale, forme juridique, adresse du siège, numéro RCCM et IFU].',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "Pour toute question sur vos données : [À COMPLÉTER : adresse email dédiée à la vie privée], ou depuis l'application (Compte › Mes données › Faire une demande).",
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '2. Quelles données utilisons-nous, et pourquoi ?',
        },
      ],
    },
    {
      type: 'heading',
      level: 3,
      text: [
        {
          text: 'Sans compte',
        },
      ],
    },
    {
      type: 'list',
      ordered: false,
      items: [
        [
          {
            text: 'Votre position',
            bold: true,
          },
          {
            text: ", si vous l'autorisez : pour trouver les stations proches et calculer l'itinéraire. Elle est envoyée à nos serveurs au moment de la recherche et n'y est jamais conservée.",
          },
        ],
        [
          {
            text: "Un identifiant d'installation",
            bold: true,
          },
          {
            text: ", tiré au hasard au premier lancement : il limite le nombre de recherches par appareil pour protéger le service. Il ne vous identifie pas et n'est pas lié à votre identité.",
          },
        ],
        [
          {
            text: 'Vos recherches',
            bold: true,
          },
          {
            text: ", sous une forme anonyme : nous comptons les recherches par zone d'environ 5 km² et par heure, sans lien avec vous, pour repérer les pénuries.",
          },
        ],
        [
          {
            text: 'Les rapports de plantage',
            bold: true,
          },
          {
            text: ", si l'application rencontre une erreur : la trace technique de l'erreur, le modèle et le système du téléphone, la version de l'application. Ils partent vers notre propre serveur de suivi des erreurs, sans votre position, sans votre adresse email, sans identifiant de compte ni d'appareil, et sans votre adresse IP. Ils servent seulement à corriger les erreurs.",
          },
        ],
      ],
    },
    {
      type: 'heading',
      level: 3,
      text: [
        {
          text: 'Avec un compte',
        },
      ],
    },
    {
      type: 'list',
      ordered: false,
      items: [
        [
          {
            text: 'Votre identité',
            bold: true,
          },
          {
            text: ' : prénom, nom, adresse email, et votre mot de passe sous une forme chiffrée que personne ne peut relire.',
          },
        ],
        [
          {
            text: "Votre activité dans l'application",
            bold: true,
          },
          {
            text: ' : stations favorites, alertes « de retour en stock », préférences et historique des notifications, signalements (motif, produit, commentaire), demandes concernant vos données.',
          },
        ],
        [
          {
            text: 'Vos sessions et appareils',
            bold: true,
          },
          {
            text: " : type d'application, modèle d'appareil et dates de connexion ; pour les notifications, le jeton de notification de votre téléphone, sa plateforme et sa langue.",
          },
        ],
        [
          {
            text: 'Les dates utiles',
            bold: true,
          },
          {
            text: ' : création du compte, dernière connexion, dernière activité, acceptation de cette politique.',
          },
        ],
      ],
    },
    {
      type: 'heading',
      level: 3,
      text: [
        {
          text: 'Si vous gérez une station',
        },
      ],
    },
    {
      type: 'list',
      ordered: false,
      items: [
        [
          {
            text: 'La station',
            bold: true,
          },
          {
            text: ' : nom, marque, IFU, RCCM, adresse, ville, téléphone, position de la station, horaires, produits vendus et stocks.',
          },
        ],
        [
          {
            text: 'Le justificatif',
            bold: true,
          },
          {
            text: " fourni à l'inscription (attestation IFU ou RCCM) : il permet à notre équipe de vérifier que la station existe et que vous la représentez. Il est chiffré et seule l'équipe de vérification peut l'ouvrir.",
          },
        ],
        [
          {
            text: "L'historique des stocks",
            bold: true,
          },
          {
            text: ' que vous saisissez, pour mesurer la fiabilité des informations.',
          },
        ],
        [
          {
            text: "Quand vous placez l'épingle de la station, la position de votre téléphone sert à vérifier la cohérence ; seule la distance entre votre téléphone et l'épingle est conservée.",
          },
        ],
      ],
    },
    {
      type: 'heading',
      level: 3,
      text: [
        {
          text: 'Ce que nous ne conservons pas',
        },
      ],
    },
    {
      type: 'list',
      ordered: false,
      items: [
        [
          {
            text: 'votre position ;',
          },
        ],
        [
          {
            text: 'la liste de vos recherches ;',
          },
        ],
        [
          {
            text: "votre adresse IP : elle sert seulement, sous forme d'empreinte et pendant une heure au plus, à limiter les abus, et n'apparaît jamais dans nos journaux.",
          },
        ],
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '3. Sur quelle base utilisons-nous vos données ?',
        },
      ],
    },
    {
      type: 'list',
      ordered: false,
      items: [
        [
          {
            text: "L'exécution du service que vous demandez",
            bold: true,
          },
          {
            text: " (conditions d'utilisation) : compte, recherche, itinéraire, favoris, alertes, notifications, espace gérant.",
          },
        ],
        [
          {
            text: 'Notre intérêt légitime',
            bold: true,
          },
          {
            text: ' à assurer un service fiable et sûr : vérification des stations, modération des signalements, sécurité des comptes, statistiques anonymes de pénurie.',
          },
        ],
        [
          {
            text: 'Votre consentement',
            bold: true,
          },
          {
            text: ', donné au système de votre téléphone : position et notifications. Vous pouvez le retirer à tout moment dans les réglages du téléphone.',
          },
        ],
        [
          {
            text: '[À COMPLÉTER après avis juridique : obligations légales applicables, par exemple en matière comptable ou de réquisition.]',
          },
        ],
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '4. Votre position',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "L'application ne demande votre position qu'au premier plan, jamais en arrière-plan. Vous pouvez refuser : vous choisissez alors un lieu sur la carte. La position est transmise de façon chiffrée, traitée en mémoire le temps de la réponse, et n'est écrite ni dans une base de données ni dans un journal.",
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "Les fonds de carte sont fournis par OpenFreeMap : pour afficher la carte, votre téléphone lui demande les images de la zone affichée, ce qui lui révèle cette zone et l'adresse IP de votre connexion (voir la section 6).",
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '5. Notifications',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: 'Les notifications (alertes « de retour en stock », rappels de stock pour les gérants, décisions sur une station) ne sont envoyées que si vous les autorisez dans le système. Pour les acheminer, nous enregistrons le jeton de notification de votre téléphone, lié à votre session : il est supprimé à la déconnexion, à la suppression du compte, ou après 90 jours sans utilisation.',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "Le contenu d'une notification passe par le service Expo puis, sur Android, par Google Firebase Cloud Messaging. Sur Android, ces messages ne contiennent ni titre ni texte : seulement le type de notification et des identifiants (station, produit), le texte étant composé sur votre téléphone. Sur iPhone, ils contiennent le titre et le texte de la notification. Le contenu est masqué sur l'écran verrouillé.",
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '6. Qui reçoit vos données ?',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "Vos données ne sont accessibles qu'à l'équipe GoStation qui en a besoin (vérification des stations, modération, support), et à nos prestataires techniques, chacun pour sa mission :",
        },
      ],
    },
    {
      type: 'table',
      header: [
        [
          {
            text: 'Prestataire',
          },
        ],
        [
          {
            text: 'Rôle',
          },
        ],
        [
          {
            text: 'Données concernées',
          },
        ],
        [
          {
            text: 'Pays',
          },
        ],
      ],
      rows: [
        [
          [
            {
              text: 'Expo (650 Industries, Inc.)',
            },
          ],
          [
            {
              text: "Acheminement des notifications ; mises à jour de l'application",
            },
          ],
          [
            {
              text: 'Jeton de notification, contenu technique des notifications ; adresse IP',
            },
          ],
          [
            {
              text: 'États-Unis',
            },
          ],
        ],
        [
          [
            {
              text: 'Google (Firebase Cloud Messaging)',
            },
          ],
          [
            {
              text: 'Livraison des notifications sur Android',
            },
          ],
          [
            {
              text: 'Jeton de notification, contenu technique des notifications',
            },
          ],
          [
            {
              text: 'États-Unis et autres pays',
            },
          ],
        ],
        [
          [
            {
              text: 'OpenFreeMap',
            },
          ],
          [
            {
              text: 'Fonds de carte',
            },
          ],
          [
            {
              text: 'Adresse IP, zones de carte affichées',
            },
          ],
          [
            {
              text: '[À COMPLÉTER]',
            },
          ],
        ],
        [
          [
            {
              text: '[À COMPLÉTER : hébergeur, choisi avant la mise en service]',
            },
          ],
          [
            {
              text: 'Hébergement des serveurs, de la base de données et des sauvegardes',
            },
          ],
          [
            {
              text: 'Toutes les données décrites ici',
            },
          ],
          [
            {
              text: '[À COMPLÉTER]',
            },
          ],
        ],
        [
          [
            {
              text: "[À COMPLÉTER : service d'envoi d'emails]",
            },
          ],
          [
            {
              text: 'Envoi des emails (codes, confirmations, réponses)',
            },
          ],
          [
            {
              text: "Adresse email, prénom, contenu de l'email",
            },
          ],
          [
            {
              text: '[À COMPLÉTER]',
            },
          ],
        ],
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "Certaines de ces données sont donc transférées hors du Bénin. [À COMPLÉTER après avis juridique : garanties encadrant ces transferts et formalités auprès de l'APDP.]",
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "Nous ne communiquons pas vos données à d'autres tiers, sauf obligation légale. Les gérants ne voient jamais l'auteur d'un signalement ni son commentaire.",
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '7. Combien de temps gardons-nous vos données ?',
        },
      ],
    },
    {
      type: 'table',
      header: [
        [
          {
            text: 'Donnée',
          },
        ],
        [
          {
            text: 'Durée',
          },
        ],
      ],
      rows: [
        [
          [
            {
              text: 'Position',
            },
          ],
          [
            {
              text: 'Aucune conservation',
            },
          ],
        ],
        [
          [
            {
              text: 'Compte',
            },
          ],
          [
            {
              text: "Tant que vous l'utilisez. Sans aucune connexion pendant 24 mois, il est supprimé ; vous êtes prévenu par email 30 jours avant",
            },
          ],
        ],
        [
          [
            {
              text: 'Boîte de réception (notifications)',
            },
          ],
          [
            {
              text: '30 jours',
            },
          ],
        ],
        [
          [
            {
              text: 'Jetons de notification',
            },
          ],
          [
            {
              text: "Jusqu'à la déconnexion, ou 90 jours sans utilisation",
            },
          ],
        ],
        [
          [
            {
              text: 'Sessions de connexion',
            },
          ],
          [
            {
              text: '30 jours sans utilisation',
            },
          ],
        ],
        [
          [
            {
              text: 'Signalements',
            },
          ],
          [
            {
              text: 'Votre nom en est retiré au bout de 90 jours (remplacé par un pseudonyme) ; le signalement est supprimé au bout de 12 mois',
            },
          ],
        ],
        [
          [
            {
              text: "Justificatif d'un gérant",
            },
          ],
          [
            {
              text: "Tant que la station est active ; 6 mois après le refus d'un dossier non renvoyé ; 12 mois après la suppression du compte du gérant",
            },
          ],
        ],
        [
          [
            {
              text: 'Historique des stocks',
            },
          ],
          [
            {
              text: '12 mois, puis regroupé par jour, sans lien avec le gérant',
            },
          ],
        ],
        [
          [
            {
              text: "Demandes de déplacement de l'épingle d'une station",
            },
          ],
          [
            {
              text: '12 mois après la décision',
            },
          ],
        ],
        [
          [
            {
              text: 'Journal de sécurité (actions sur les comptes et les stations)',
            },
          ],
          [
            {
              text: '12 mois',
            },
          ],
        ],
        [
          [
            {
              text: 'Demandes concernant vos données',
            },
          ],
          [
            {
              text: "3 ans après leur clôture, pour prouver qu'elles ont été traitées",
            },
          ],
        ],
        [
          [
            {
              text: 'Copie de vos données',
            },
          ],
          [
            {
              text: '24 heures après sa préparation',
            },
          ],
        ],
        [
          [
            {
              text: 'Rapports de plantage',
            },
          ],
          [
            {
              text: '30 jours',
            },
          ],
        ],
        [
          [
            {
              text: 'Statistiques de recherche par zone',
            },
          ],
          [
            {
              text: 'Sans limite : elles sont anonymes',
            },
          ],
        ],
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: 'Les sauvegardes de nos serveurs, chiffrées, suivent une rotation : une donnée supprimée en disparaît au plus tard 3 mois après sa suppression.',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: 'Ces durées sont proposées et restent à valider. [À COMPLÉTER après avis juridique.]',
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '8. Sécurité',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "Les échanges avec nos serveurs sont chiffrés. Les mots de passe sont stockés sous une forme irréversible (argon2id), les justificatifs et les copies de données sont chiffrés, les codes envoyés par email expirent vite et ne servent qu'une fois, et l'équipe d'administration se connecte avec une double authentification. Nos journaux techniques ne contiennent ni position, ni adresse IP, ni contenu de notification.",
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '9. Vos droits',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: 'Vous pouvez à tout moment :',
        },
      ],
    },
    {
      type: 'list',
      ordered: false,
      items: [
        [
          {
            text: 'accéder à vos données',
            bold: true,
          },
          {
            text: ' et en obtenir une copie : Compte › Mes données › Télécharger mes données (fichier lisible, disponible 24 heures) ;',
          },
        ],
        [
          {
            text: 'les faire rectifier',
            bold: true,
          },
          {
            text: ' : Compte › Modifier le profil, ou par une demande ;',
          },
        ],
        [
          {
            text: 'vous opposer',
            bold: true,
          },
          {
            text: ' à un traitement fondé sur notre intérêt légitime ;',
          },
        ],
        [
          {
            text: 'supprimer votre compte',
            bold: true,
          },
          {
            text: ' : Compte › Mes données › Supprimer mon compte ;',
          },
        ],
        [
          {
            text: 'faire toute autre demande',
            bold: true,
          },
          {
            text: ' concernant vos données.',
          },
        ],
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "Depuis l'application, vous êtes déjà identifié. Si vous nous écrivez par email, nous envoyons un code à l'adresse de votre compte : nous traitons la demande une fois ce code communiqué, pour être sûrs qu'elle vient de vous. Nous répondons dans un délai de [À COMPLÉTER : délai légal, 30 jours proposés], et vous recevez un accusé de réception avec la référence de votre demande.",
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "Si vous estimez que vos droits ne sont pas respectés, vous pouvez saisir l'Autorité de protection des données à caractère personnel (APDP) du Bénin : [À COMPLÉTER : coordonnées de l'APDP].",
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '10. Enfants',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "GoStation ne s'adresse pas aux enfants. [À COMPLÉTER après avis juridique : âge minimum pour créer un compte.]",
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '11. Modifications de cette politique',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "Si cette politique change, l'application vous présente la nouvelle version, que vous devez accepter pour continuer à utiliser votre compte. Chaque version porte un numéro et une date.",
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '12. Nous contacter',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: '[À COMPLÉTER : adresse email dédiée à la vie privée et adresse postale du responsable du traitement.]',
        },
      ],
    },
  ],
}

export const terms: LegalDocument = {
  meta: {
    title: "Conditions d'utilisation",
    version: '1.0',
    updated: '16 octobre 2026',
  },
  blocks: [
    {
      type: 'heading',
      level: 1,
      text: [
        {
          text: "Conditions d'utilisation de GoStation",
        },
      ],
    },
    {
      type: 'note',
      text: [
        {
          text: 'PROJET — à faire valider par un juriste.',
          bold: true,
        },
        {
          text: " Ce texte n'est pas encore en vigueur : les mentions entre crochets sont à compléter avant la mise en service.",
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "Ces conditions encadrent l'utilisation de l'application GoStation, éditée par [À COMPLÉTER : raison sociale, adresse, RCCM, IFU] (« nous »). En créant un compte, vous les acceptez, avec la ",
        },
        {
          text: 'politique de confidentialité',
          href: '/legal/privacy',
        },
        {
          text: '.',
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '1. Le service',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "GoStation affiche les stations-service et points de vente de gaz du Bénin, avec l'état de leurs stocks tel que le déclarent leurs gérants, leurs horaires et l'itinéraire pour s'y rendre. Le service est gratuit. La recherche ne demande pas de compte ; un compte donne accès aux favoris, aux alertes « de retour en stock » et aux signalements. Les gérants disposent d'un espace pour tenir à jour les informations de leur station.",
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '2. Votre compte',
        },
      ],
    },
    {
      type: 'list',
      ordered: false,
      items: [
        [
          {
            text: 'Vous fournissez des informations exactes et vous les tenez à jour.',
          },
        ],
        [
          {
            text: "Votre mot de passe est personnel : ne le communiquez à personne. Prévenez-nous sans attendre si vous pensez qu'il a été utilisé par quelqu'un d'autre.",
          },
        ],
        [
          {
            text: 'Un compte correspond à une personne. Un compte gérant correspond à une station.',
          },
        ],
        [
          {
            text: "Vous pouvez supprimer votre compte à tout moment depuis l'application (Compte › Mes données).",
          },
        ],
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '3. Les informations affichées',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "Les stocks, horaires et positions des stations sont déclarés par leurs gérants et complétés par les signalements des utilisateurs. Nous indiquons leur fraîcheur (« mis à jour il y a… ») et retirons de la recherche les stocks trop anciens, mais nous ne pouvons pas garantir qu'un produit sera disponible à votre arrivée. Les itinéraires et durées sont des estimations : respectez toujours le code de la route et la signalisation. N'utilisez pas l'application en conduisant sans support fixe.",
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '4. Engagements des gérants',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: 'En gérant une station sur GoStation, vous vous engagez à :',
        },
      ],
    },
    {
      type: 'list',
      ordered: false,
      items: [
        [
          {
            text: 'représenter réellement la station',
            bold: true,
          },
          {
            text: ' : le justificatif fourni (attestation IFU ou RCCM) doit être authentique et vous concerner ;',
          },
        ],
        [
          {
            text: "placer l'épingle sur la station elle-même",
            bold: true,
          },
          {
            text: ', et non sur un autre lieu ; un déplacement important est vérifié par notre équipe ;',
          },
        ],
        [
          {
            text: 'déclarer des stocks exacts',
            bold: true,
          },
          {
            text: " et les mettre à jour dès qu'ils changent, en particulier lors d'une rupture ; répondre aux rappels de mise à jour ;",
          },
        ],
        [
          {
            text: 'tenir à jour les horaires',
            bold: true,
          },
          {
            text: ' et les fermetures exceptionnelles ;',
          },
        ],
        [
          {
            text: 'ne pas utiliser GoStation pour dénigrer une autre station ou tromper les utilisateurs.',
          },
        ],
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "Un dossier de gérant est vérifié par notre équipe avant que la station n'apparaisse dans la recherche. Nous pouvons refuser un dossier incomplet ou invalide, en indiquant le motif.",
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '5. Signalements',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "Les signalements (rupture de stock, station fermée, position incorrecte, autre) aident tout le monde. Ils doivent être faits de bonne foi, sur place ou en connaissance de cause. Les signalements abusifs (faux, répétés, injurieux ou visant à nuire à une station) sont classés sans suite ; en cas de répétition, nous pouvons retirer le droit de signaler. Les gérants ne voient jamais l'auteur d'un signalement.",
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '6. Suspension et suppression',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "Nous pouvons suspendre une station ou désactiver un compte en cas de manquement à ces conditions (informations fausses, justificatif non authentique, stocks volontairement erronés, signalements abusifs, usage frauduleux ou atteinte à la sécurité du service). Sauf urgence, nous indiquons le motif par email ; vous pouvez y répondre pour contester la décision. Une station suspendue n'apparaît plus dans la recherche jusqu'à sa réactivation.",
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '7. Responsabilité',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "Nous faisons notre possible pour que le service soit disponible et exact, sans pouvoir le garantir : il peut être interrompu pour maintenance ou en cas de panne. Nous ne sommes pas responsables d'un déplacement inutile vers une station dont le stock ou les horaires étaient inexacts, ni des informations déclarées par les gérants. [À COMPLÉTER après avis juridique : limites de responsabilité admises par le droit béninois.]",
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '8. Propriété intellectuelle',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "L'application, sa marque et son logo nous appartiennent. Les fonds de carte proviennent d'OpenFreeMap et d'OpenMapTiles, à partir des données © les contributeurs d'OpenStreetMap. Vous ne pouvez pas extraire de façon systématique les données affichées par GoStation.",
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '9. Données personnelles',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "L'utilisation de vos données est décrite dans la ",
        },
        {
          text: 'politique de confidentialité',
          href: '/legal/privacy',
        },
        {
          text: '.',
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '10. Modifications',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: "Nous pouvons modifier ces conditions. Chaque version porte un numéro et une date ; une modification importante vous est présentée dans l'application avant de s'appliquer.",
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '11. Droit applicable',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: 'Ces conditions sont soumises au droit béninois. [À COMPLÉTER après avis juridique : tribunal compétent et médiation préalable éventuelle.]',
        },
      ],
    },
    {
      type: 'heading',
      level: 2,
      text: [
        {
          text: '12. Nous contacter',
        },
      ],
    },
    {
      type: 'paragraph',
      text: [
        {
          text: '[À COMPLÉTER : adresse email de contact et adresse postale.]',
        },
      ],
    },
  ],
}
