import { create } from 'zustand'

/**
 * État de connexion : `unknown` au démarrage (lecture du refresh token dans le Keystore), puis
 * `signedIn` / `signedOut`. Le profil vient de GET /me (TanStack Query).
 */
export type AuthStatus = 'unknown' | 'signedIn' | 'signedOut'

export const useAuth = create<{ status: AuthStatus; setStatus: (s: AuthStatus) => void }>((set) => ({
  status: 'unknown',
  setStatus: (status) => set({ status }),
}))
