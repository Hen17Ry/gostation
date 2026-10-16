const DAY = 86_400_000

/**
 * Jours entiers avant l'échéance d'une demande, arrondis vers le haut (1 : moins de 24 h) ;
 * négatif une fois l'échéance passée (-1 : en retard de moins de 24 h).
 */
export function daysLeft(dueAt: string, now = Date.now()): number {
  const ms = new Date(dueAt).getTime() - now
  return ms > 0 ? Math.ceil(ms / DAY) : -Math.max(1, Math.ceil(-ms / DAY))
}
