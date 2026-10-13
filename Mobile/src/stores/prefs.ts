import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { storage } from '@/lib/storage'

/**
 * Préférences locales (MMKV, non sensibles) : accueil vu, dernier produit choisi, guidage vocal.
 * Jamais de position.
 */
interface Prefs {
  onboarded: boolean
  productId: number | null
  voice: boolean
  setOnboarded: () => void
  setProductId: (id: number) => void
  setVoice: (on: boolean) => void
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      onboarded: false,
      productId: null,
      voice: false,
      setOnboarded: () => set({ onboarded: true }),
      setProductId: (productId) => set({ productId }),
      setVoice: (voice) => set({ voice }),
    }),
    {
      name: 'prefs',
      storage: createJSONStorage(() => ({
        getItem: (k) => storage.getString(k) ?? null,
        setItem: (k, v) => storage.set(k, v),
        removeItem: (k) => void storage.remove(k),
      })),
      partialize: ({ onboarded, productId, voice }) => ({ onboarded, productId, voice }),
    },
  ),
)
