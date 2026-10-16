import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import * as Notifications from 'expo-notifications'
import { type Href, router, usePathname, useRootNavigationState } from 'expo-router'
import { useEffect, useState } from 'react'

import { markNotificationsRead } from '@/api/account'
import { managerKeys, meKeys } from '@/api/keys'
import { toast } from '@/components/ui/toast'
import { notificationText } from '@/features/inbox/notification-text'
import { useMe } from '@/features/auth/use-me'
import { useSpace } from '@/features/manager/space'
import { t } from '@/i18n'

import { ACTION_CONFIRM, setupNotificationChannels } from './channels'
import { claimResponse, confirmUnchangedStocks, responseKey } from './confirm'
import { usePushPermissionRefresh } from './permission'
import { isPushType } from './present'
import { usePushRegistration } from './registration'
import { notificationHref, pushData } from './routing'

// App ouverte : jamais de notification système en double. Le push est annoncé par un toast et la
// boîte de réception est rechargée (compteur des non lues).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

function refresh(qc: QueryClient, data: Record<string, unknown>) {
  void qc.invalidateQueries({ queryKey: meKeys.notifications() })
  if (data.type === 'stock_reminder' || data.type === 'station_reported') {
    void qc.invalidateQueries({ queryKey: managerKeys.all })
  }
  if (data.type === 'station_decision') void qc.invalidateQueries({ queryKey: meKeys.profile() })
}

/** Push reçu app ouverte : toast composé d'après le type et les données (jamais un texte serveur). */
export function onForegroundPush(qc: QueryClient, n: Notifications.Notification) {
  const data = pushData(n.request.content)
  if (data.local || !isPushType(data.type)) return
  toast.info(notificationText({ type: data.type, data }))
  refresh(qc, data)
}

/**
 * Notification touchée (ou action « Mettre à jour ») : ouvre l'écran du type et marque la
 * notification lue. « Rien n'a changé » arrive ici quand l'app était au premier plan (la tâche de
 * fond ne tourne pas alors) : confirmation immédiate et toast.
 */
export async function onPushResponse(
  qc: QueryClient,
  r: Notifications.NotificationResponse,
  navigate: (href: Href) => void = (href) => router.push(href),
) {
  if (!claimResponse(responseKey(r))) return
  const data = pushData(r.notification.request.content)
  if (r.actionIdentifier === ACTION_CONFIRM) {
    await Notifications.dismissNotificationAsync(r.notification.request.identifier).catch(() => undefined)
    const outcome = await confirmUnchangedStocks()
    if (outcome === 'confirmed') toast.success(t.push.confirmedToast)
    else toast.error(t.push.confirmFailedBody)
    void qc.invalidateQueries({ queryKey: managerKeys.all })
    return
  }
  if (typeof data.notificationId === 'string') {
    void markNotificationsRead({ ids: [data.notificationId] })
      .then(() => qc.invalidateQueries({ queryKey: meKeys.notifications() }))
      .catch(() => undefined)
  }
  refresh(qc, data)
  // Décision sur la station : le profil relu fixe l'espace (statut ou station) avant le lien,
  // sinon l'espace encore en cache le refuserait.
  if (data.type === 'station_decision') {
    await qc.invalidateQueries({ queryKey: meKeys.profile() }).catch(() => undefined)
  }
  const href = notificationHref(data)
  if (href) navigate(href)
}

/**
 * Notifications de l'app, monté une fois sous la navigation : canaux et catégorie, autorisation,
 * enregistrement de l'appareil, push au premier plan, réponses (y compris celle qui a lancé
 * l'app).
 */
export function NotificationsRuntime() {
  const qc = useQueryClient()
  // Lien d'une notification, ouvert une fois l'espace du compte installé : au lancement à froid, la
  // réponse arrive avant le profil (GET /me), qui fixe l'espace ; le changement d'espace remplacerait
  // l'écran demandé par l'accueil (« / » puis celui du gérant).
  const [pending, setPending] = useState<Href | null>(null)
  const { me } = useMe()
  const space = useSpace()
  const pathname = usePathname()
  const navigationReady = !!useRootNavigationState()?.key && !!me && (space === 'user' || pathname !== '/')
  usePushPermissionRefresh()
  usePushRegistration()
  useEffect(() => {
    void setupNotificationChannels().catch(() => undefined)
    const received = Notifications.addNotificationReceivedListener((n) => onForegroundPush(qc, n))
    const responses = Notifications.addNotificationResponseReceivedListener(
      (r) => void onPushResponse(qc, r, setPending),
    )
    // App lancée par une notification : sa réponse attend ici.
    void Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) void onPushResponse(qc, r, setPending)
      void Notifications.clearLastNotificationResponseAsync()
    })
    return () => {
      received.remove()
      responses.remove()
    }
  }, [qc])
  useEffect(() => {
    if (!pending || !navigationReady) return
    const id = setTimeout(() => {
      router.push(pending)
      setPending(null)
    })
    return () => clearTimeout(id)
  }, [pending, navigationReady])
  return null
}
