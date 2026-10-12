import { useSyncExternalStore } from 'react'

/**
 * Thème : suit le système par défaut (prefers-color-scheme), bascule clair / sombre / système
 * mémorisée dans le navigateur. Le script en tête d'index.html applique la même règle avant le
 * premier rendu (pas de flash) ; ce module prend le relais et suit les changements.
 */
export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'gs-theme'
const media = () => window.matchMedia('(prefers-color-scheme: dark)')

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

let preference: ThemePreference = typeof window === 'undefined' ? 'system' : readPreference()
const listeners = new Set<() => void>()

function resolve(pref: ThemePreference): ResolvedTheme {
  if (pref !== 'system') return pref
  return media().matches ? 'dark' : 'light'
}

function apply() {
  const resolved = resolve(preference)
  const root = document.documentElement
  // Pas de transitions de couleurs pendant la bascule : tout change en une image.
  root.classList.add('theme-switching')
  root.classList.toggle('dark', resolved === 'dark')
  root.dataset.theme = resolved
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')))
  for (const l of listeners) l()
}

export function setThemePreference(next: ThemePreference) {
  preference = next
  try {
    if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, next)
  } catch {
    // Stockage indisponible (navigation privée) : la préférence vaut pour la session.
  }
  apply()
}

let started = false
/** Branche les écouteurs (système et autres onglets). Idempotent. */
export function startThemeSync() {
  if (started || typeof window === 'undefined') return
  started = true
  media().addEventListener('change', () => preference === 'system' && apply())
  window.addEventListener('storage', (e) => {
    if (e.key !== THEME_STORAGE_KEY) return
    preference = readPreference()
    apply()
  })
  apply()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

let snapshot = { preference, resolved: 'light' as ResolvedTheme }
function getSnapshot() {
  const resolved = typeof window === 'undefined' ? 'light' : resolve(preference)
  if (snapshot.preference !== preference || snapshot.resolved !== resolved) snapshot = { preference, resolved }
  return snapshot
}

export function useTheme() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return { ...s, setPreference: setThemePreference }
}
