import { t } from '@/i18n'

/** « GoStation/0.1.0 (Android 16; Pixel 7) » → « Pixel 7 · Android 16 » ; navigateur pour l'admin. */
export function deviceLabel(s: { client: 'mobile' | 'web'; userAgent: string }): string {
  const m = /^GoStation\/[^ ]+ \(([^;]+); ([^)]+)\)/.exec(s.userAgent)
  if (m) return `${m[2]} · ${m[1]}`
  return s.client === 'web' ? t.account.webSession : s.userAgent || t.account.unknownDevice
}
