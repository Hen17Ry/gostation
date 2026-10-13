import { Image } from 'expo-image'
import { Camera, FileText, FolderOpen, RefreshCw, Trash2 } from 'lucide-react-native'
import { useState } from 'react'
import { View } from 'react-native'

import type { DocumentFile } from '@/api/manager'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Text } from '@/components/ui/text'
import { t } from '@/i18n'
import { cn } from '@/lib/cn'
import { haptics } from '@/lib/haptics'
import { useTheme } from '@/theme/theme'

import { discardDocument, DocumentError, pickFile, takePhoto } from './document'

const sizeLabel = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`
    : `${Math.max(1, Math.round(bytes / 1024))} Ko`

/**
 * Justificatif (D62) : photo ou fichier, aperçu (image, ou fiche du PDF), remplacer, retirer.
 * La copie locale est supprimée quand le justificatif est retiré ou remplacé.
 */
export function DocumentField({
  value,
  onChange,
  error,
}: {
  value: DocumentFile | null
  onChange: (f: DocumentFile | null) => void
  error?: string | null
}) {
  const { colors } = useTheme()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const choose = async (how: 'photo' | 'file') => {
    setProblem(null)
    setBusy(true)
    try {
      const f = how === 'photo' ? await takePhoto() : await pickFile()
      if (!f) return
      discardDocument(value)
      onChange(f)
      haptics.success()
    } catch (e) {
      haptics.error()
      setProblem(e instanceof DocumentError ? e.message : t.common.errorTitle)
    } finally {
      setBusy(false)
    }
  }

  const message = problem ?? error ?? null
  return (
    <View className="gap-3">
      {value ? (
        <View
          testID="document-preview"
          accessible
          accessibilityLabel={`${t.manager.documentPreview} : ${value.name}, ${sizeLabel(value.size)}`}
          className="overflow-hidden rounded-xl border border-border bg-card"
        >
          {value.mimeType === 'application/pdf' ? (
            <View className="h-40 items-center justify-center gap-2 bg-secondary">
              <FileText size={40} color={colors['brand-text']} />
              <Text variant="subhead" weight="semibold">
                {t.manager.pdfFile}
              </Text>
            </View>
          ) : (
            <Image
              source={{ uri: value.uri }}
              contentFit="contain"
              style={{ height: 220, backgroundColor: colors.secondary }}
            />
          )}
          <View className="flex-row items-center gap-2 px-4 py-3">
            <Text variant="footnote" tone="muted" numberOfLines={1} className="flex-1">
              {value.name} · {sizeLabel(value.size)}
            </Text>
          </View>
        </View>
      ) : (
        <View
          className={cn(
            'items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6',
            message ? 'border-destructive' : 'border-border-strong',
          )}
        >
          {busy ? (
            <Spinner color={colors.primary} size={28} />
          ) : (
            <FileText size={32} color={colors['muted-foreground']} />
          )}
          <Text variant="subhead" tone="muted" className="text-center">
            {busy ? t.manager.preparing : t.manager.documentHint}
          </Text>
        </View>
      )}

      <View className="flex-row gap-3">
        <Button
          testID="document-photo"
          label={value ? t.manager.replaceDocument : t.manager.takePhoto}
          icon={value ? RefreshCw : Camera}
          variant={value ? 'outline' : 'primary'}
          disabled={busy}
          className="flex-1"
          onPress={() => choose('photo')}
        />
        <Button
          testID="document-file"
          label={t.manager.pickFile}
          icon={FolderOpen}
          variant="outline"
          disabled={busy}
          className="flex-1"
          onPress={() => choose('file')}
        />
      </View>
      {value && (
        <Button
          label={t.manager.removeDocument}
          icon={Trash2}
          variant="ghost"
          size="sm"
          className="self-start"
          onPress={() => {
            discardDocument(value)
            onChange(null)
          }}
        />
      )}
      {message && (
        <Text variant="footnote" tone="destructive" accessibilityRole="alert">
          {message}
        </Text>
      )}
    </View>
  )
}
