import { configure } from '@testing-library/react-native'

// Dernier recours, après les causes évitables (icônes chargées à la demande : lucide-lazy.js ;
// horloge simulée pour le suivi de la copie des données). Les parcours d'écran (saisie des stocks,
// 412, hors connexion) coûtent 0,3 à 1,5 s de CPU seuls ; lancés avec Go (-race, un PostGIS par
// paquet) et Vitest, la machine était 3 à 4 fois surchargée (charge moyenne 21 sur 8 cœurs) et
// ils dépassaient 5 s. Les délais servent à repérer un blocage, pas une machine chargée : 15 s par
// test (testTimeout, package.json) et 3 s par attente (findBy*, waitFor) au lieu d'1 s.
configure({ asyncUtilTimeout: 3_000 })
