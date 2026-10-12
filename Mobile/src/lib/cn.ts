/** Concatène des classes (sans fusion intelligente : les composants évitent les conflits). */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
