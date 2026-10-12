import { createHmac } from 'node:crypto'

/** TOTP RFC 6238 (HMAC-SHA1, 6 chiffres, 30 s), comme l'application d'authentification. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32(secret: string): Buffer {
  let bits = ''
  for (const c of secret.replace(/[\s=]/g, '').toUpperCase()) {
    const v = ALPHABET.indexOf(c)
    if (v < 0) throw new Error(`base32 invalide : ${c}`)
    bits += v.toString(2).padStart(5, '0')
  }
  const bytes = bits.match(/.{8}/g) ?? []
  return Buffer.from(bytes.map((b) => parseInt(b, 2)))
}

export const currentStep = (now = Date.now()) => Math.floor(now / 30_000)

export function totp(secret: string, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const h = createHmac('sha1', base32(secret)).update(counter).digest()
  const o = h[h.length - 1]! & 0x0f
  const n = (h.readUInt32BE(o) & 0x7fffffff) % 1_000_000
  return String(n).padStart(6, '0')
}

/**
 * Code d'un pas jamais utilisé : l'API refuse un pas déjà accepté (anti-rejeu) mais tolère ±1 pas.
 * On prend le pas courant, ou le suivant s'il a déjà servi.
 */
export function freshTotp(secret: string, lastStep?: number): { code: string; step: number } {
  const step = Math.max(currentStep(), (lastStep ?? -1) + 1)
  return { code: totp(secret, step), step }
}
