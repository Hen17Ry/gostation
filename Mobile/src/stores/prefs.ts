import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { storage } from '@/lib/storage'

/**
 * Espace du dernier compte connecté (D58) : rôle et statut de la station, sans donnée personnelle.
 * Ouvre le bon espace au démarrage, avant `GET /me` ou hors connexion.
 */
export interface SpaceHint {
  role: 'user' | 'manager' | 'admin'
  stationStatus: 'pending' | 'approved' | 'rejected' | 'suspended' | null
}

/**
 * Préférences locales (MMKV, non sensibles) : accueil vu, dernier produit choisi, guidage vocal,
 * espace du compte. Jamais de position.
 */
interface Prefs {
  onboarded: boolean
  productId: number | null
  voice: boolean
  space: SpaceHint | null
  setOnboarded: () => void
  setProductId: (id: number) => void
  setVoice: (on: boolean) => void
  setSpace: (space: SpaceHint | null) => void
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      onboarded: false,
      productId: null,
      voice: false,
      space: null,
      setOnboarded: () => set({ onboarded: true }),
      setProductId: (productId) => set({ productId }),
      setVoice: (voice) => set({ voice }),
      setSpace: (space) => set({ space }),
    }),
    {
      name: 'prefs',
      storage: createJSONStorage(() => ({
        getItem: (k) => storage.getString(k) ?? null,
        setItem: (k, v) => storage.set(k, v),
        removeItem: (k) => void storage.remove(k),
      })),
      partialize: ({ onboarded, productId, voice, space }) => ({ onboarded, productId, voice, space }),
    },
  ),
)
