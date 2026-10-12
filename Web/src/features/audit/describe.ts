import type { AuditEntry } from '@/api/admin-schemas'
import { ta } from '@/i18n/admin'
import { formatDistance } from '@/lib/format'

/** Libellé lisible d'une action d'audit (repli : le code). */
export const actionLabel = (action: string) => ta.audit.actions[action] ?? action

/** Nom de l'acteur : « Prénom Nom », sinon email, sinon Système / compte supprimé. */
export function actorName(e: AuditEntry): string {
  if (!e.actor) return ta.audit.system
  const name = [e.actor.firstName, e.actor.lastName].filter(Boolean).join(' ')
  return name || e.actor.email || ta.audit.deletedActor
}

const FIELD_LABELS: Record<string, string> = {
  ...ta.station.fields,
  sortOrder: 'Ordre',
  active: 'Actif',
  label: 'Libellé',
}

export interface Change {
  field: string
  label: string
  from: string
  to: string
}

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return ta.common.none
  if (typeof v === 'boolean') return v ? ta.common.yes : ta.common.no
  return String(v)
}

/** Modifications portées par l'entrée : `changes` {champ: {from, to}} ou transition de statut. */
export function auditChanges(e: AuditEntry): Change[] {
  const out: Change[] = []
  const changes = e.metadata.changes
  if (changes && typeof changes === 'object') {
    for (const [field, v] of Object.entries(changes as Record<string, { from?: unknown; to?: unknown }>)) {
      out.push({ field, label: FIELD_LABELS[field] ?? field, from: show(v?.from), to: show(v?.to) })
    }
  }
  const { from, to } = e.metadata
  if (typeof from === 'string' && typeof to === 'string' && e.entityType === 'station') {
    out.push({
      field: 'status',
      label: ta.audit.statusChange,
      from: ta.station.statuses[from] ?? from,
      to: ta.station.statuses[to] ?? to,
    })
  }
  return out
}

/** Résumé d'une ligne (historique de station) : motif, déplacement, première modification. */
export function auditSummary(e: AuditEntry): string | undefined {
  const m = e.metadata
  const parts: string[] = []
  const changes = auditChanges(e)
  if (changes.length > 0) parts.push(changes.map((c) => `${c.label} : ${c.from} → ${c.to}`).join(' · '))
  if (typeof m.moveMeters === 'number') parts.push(`${ta.audit.metaKeys.moveMeters} : ${formatDistance(m.moveMeters)}`)
  if (typeof m.reason === 'string' && m.reason) parts.push(`${ta.common.reason} : ${m.reason}`)
  if (typeof m.note === 'string' && m.note) parts.push(`${ta.audit.metaKeys.note} : ${m.note}`)
  return parts.length > 0 ? parts.join(' — ') : undefined
}

/** Autres détails (clé → valeur lisible), hors modifications et clés techniques masquées. */
export function auditDetails(e: AuditEntry): Array<{ key: string; label: string; value: string }> {
  const hidden = new Set<string>([...ta.audit.hiddenKeys, 'changes'])
  if (e.entityType === 'station') {
    hidden.add('from')
    hidden.add('to')
  }
  return Object.entries(e.metadata)
    .filter(([k]) => !hidden.has(k))
    .map(([k, v]) => ({
      key: k,
      label: ta.audit.metaKeys[k] ?? k,
      value:
        (k === 'moveMeters' || k === 'deviceDistanceMeters') && typeof v === 'number'
          ? formatDistance(v)
          : typeof v === 'object' && v !== null
            ? JSON.stringify(v)
            : show(v),
    }))
}
