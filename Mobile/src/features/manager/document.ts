import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'

import type { DocumentFile } from '@/api/manager'
import { t } from '@/i18n'

/**
 * Justificatif du gérant (D62) : photo prise avec l'appareil ou fichier choisi (PDF, JPG, PNG).
 * Les images sont réduites sur le téléphone (2 000 px au plus, JPEG) pour rester bien sous 5 Mo et
 * économiser la data ; un fichier de plus de 5 Mo est refusé avant l'envoi. Les copies locales sont
 * supprimées après l'envoi (`discardDocument`) : rien n'est conservé sur le téléphone.
 */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024
const MAX_SIDE = 2000
const JPEG_QUALITY = 0.72

export class DocumentError extends Error {}

const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png'] as const
type Accepted = (typeof ACCEPTED)[number]

/** Réduit une image (côté le plus long ≤ 2 000 px) et la recompresse en JPEG. */
async function shrink(uri: string, name: string): Promise<DocumentFile> {
  const original = await ImageManipulator.manipulate(uri).renderAsync()
  const { width, height } = original
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  const ctx = ImageManipulator.manipulate(uri)
  if (scale < 1)
    ctx.resize(width >= height ? { width: Math.round(width * scale) } : { height: Math.round(height * scale) })
  const out = await (await ctx.renderAsync()).saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG })
  if (out.uri !== uri) discardUri(uri)
  const size = new File(out.uri).size ?? 0
  return checked({ uri: out.uri, name: name.replace(/\.(png|jpe?g)$/i, '') + '.jpg', mimeType: 'image/jpeg', size })
}

function checked(f: DocumentFile): DocumentFile {
  if (f.size > MAX_DOCUMENT_BYTES) {
    discardUri(f.uri)
    throw new DocumentError(t.manager.documentTooLarge)
  }
  return f
}

/** Photo prise avec l'appareil (permission demandée au moment du besoin). null : annulé. */
export async function takePhoto(): Promise<DocumentFile | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync()
  if (!perm.granted) throw new DocumentError(t.manager.cameraDenied)
  const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9, exif: false })
  const asset = res.canceled ? null : res.assets[0]
  if (!asset) return null
  return shrink(asset.uri, `justificatif-${Date.now()}.jpg`)
}

/** Fichier choisi par le sélecteur du système (aucune permission de stockage). null : annulé. */
export async function pickFile(): Promise<DocumentFile | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: [...ACCEPTED],
    copyToCacheDirectory: true,
    multiple: false,
  })
  const asset = res.canceled ? null : res.assets[0]
  if (!asset) return null
  const mime = (asset.mimeType ?? '') as Accepted
  if (!ACCEPTED.includes(mime)) {
    discardUri(asset.uri)
    throw new DocumentError(t.manager.documentType)
  }
  if (mime !== 'application/pdf') return shrink(asset.uri, asset.name)
  return checked({
    uri: asset.uri,
    name: asset.name,
    mimeType: mime,
    size: asset.size ?? new File(asset.uri).size ?? 0,
  })
}

function discardUri(uri: string) {
  try {
    const f = new File(uri)
    if (f.exists) f.delete()
  } catch {
    // Fichier déjà supprimé ou hors du cache de l'app : rien à faire.
  }
}

/** Supprime la copie locale du justificatif (après l'envoi, ou quand il est retiré). */
export const discardDocument = (f: DocumentFile | null) => {
  if (f) discardUri(f.uri)
}
