import { router, useNavigation } from 'expo-router'
import { useCallback } from 'react'
import { Keyboard } from 'react-native'

import type { Profile } from '@/api/schemas'
import { hintOf, SPACE_HOME, spaceOf } from '@/features/manager/space'
import { usePrefs } from '@/stores/prefs'

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

/**
 * Fin d'une connexion, d'une inscription ou d'une vérification : un gérant rejoint son espace
 * (stocks ou statut, D58), un utilisateur revient à l'écran qui avait ouvert le parcours.
 */
export function useLeaveAuth() {
  const closeFlow = useCloseFlow()
  return useCallback(
    (me?: Profile) => {
      const hint = me ? hintOf(me) : null
      const space = spaceOf(hint)
      if (space === 'user') {
        closeFlow()
        return
      }
      Keyboard.dismiss()
      // Espace mémorisé tout de suite : les gardes de navigation basculent sans attendre GET /me.
      usePrefs.getState().setSpace(hint)
      // Parcours ouvert en modal (connexion, inscription) : on le referme avant de changer d'espace.
      if (router.canDismiss()) router.dismissAll()
      router.replace(SPACE_HOME[space])
    },
    [closeFlow],
  )
}
