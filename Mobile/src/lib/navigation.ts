import { router, useNavigation } from 'expo-router'
import { useCallback } from 'react'
import { Keyboard } from 'react-native'

/**
 * Ferme un parcours ouvert dans sa propre pile (authentification en modal, suppression du compte)
 * et revient exactement à l'écran qui l'avait ouvert (fiche station, onglet Compte…) : on recule
 * d'un cran dans le navigateur parent, ce qui retire la pile du parcours entière. (`dismissAll` ne
 * convient pas : il remonte jusqu'à la pile racine et fermerait aussi l'écran d'origine.) Le
 * clavier est refermé : il masquerait la barre d'onglets de l'écran retrouvé.
 */
export function useCloseFlow() {
  const navigation = useNavigation()
  return useCallback(() => {
    Keyboard.dismiss()
    const parent = navigation.getParent()
    if (parent?.canGoBack()) parent.goBack()
    else router.replace('/')
  }, [navigation])
}
