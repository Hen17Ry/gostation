import { type Href, router } from 'expo-router'
import { Linking, View } from 'react-native'

import { Banner } from '@/components/ui/banner'
import { Screen } from '@/components/ui/screen'
import { Text } from '@/components/ui/text'
import { t } from '@/i18n'

import { type Block, type Inline, type LegalDocument, plain } from './markdown'

/**
 * Texte légal rendu depuis sa source Markdown (docs/legal, généré par npm run gen:legal) : titres
 * annoncés comme tels, listes, tableaux en cartes (lisibles à 360 dp), liens internes ou externes.
 */
export function LegalScreen({ doc }: { doc: LegalDocument }) {
  const [first, ...rest] = doc.blocks
  const title = first?.type === 'heading' && first.level === 1 ? plain(first.text) : (doc.meta.title ?? '')
  const blocks = first?.type === 'heading' && first.level === 1 ? rest : doc.blocks
  return (
    <Screen title={doc.meta.title ?? title} subtitle={t.legal.version(doc.meta.version ?? '', doc.meta.updated ?? '')}>
      {blocks.map((b, i) => (
        <LegalBlock key={i} block={b} />
      ))}
    </Screen>
  )
}

function LegalBlock({ block: b }: { block: Block }) {
  switch (b.type) {
    case 'heading':
      return (
        <Text variant={b.level <= 2 ? 'title3' : 'headline'} accessibilityRole="header" className="pt-2">
          {plain(b.text)}
        </Text>
      )
    case 'paragraph':
      return <Rich text={b.text} />
    case 'note':
      return (
        <Banner tone="warning">
          <Rich text={b.text} tone="warning" variant="footnote" />
        </Banner>
      )
    case 'list':
      return (
        <View className="gap-2" accessibilityRole="list">
          {b.items.map((item, i) => (
            <View key={i} className="flex-row gap-2.5 pr-2">
              <Text variant="body" tone="muted" accessibilityElementsHidden importantForAccessibility="no">
                {b.ordered ? `${i + 1}.` : '•'}
              </Text>
              <View className="flex-1">
                <Rich text={item} />
              </View>
            </View>
          ))}
        </View>
      )
    case 'table':
      return (
        <View className="gap-2">
          {b.rows.map((row, i) => (
            <View key={i} className="gap-1.5 rounded-xl border border-border bg-surface p-4">
              <Rich text={row[0] ?? []} strong />
              {row.slice(1).map((cell, j) => (
                <View key={j} className="gap-0.5">
                  <Text variant="caption" tone="muted">
                    {plain(b.header[j + 1] ?? [])}
                  </Text>
                  <Rich text={cell} />
                </View>
              ))}
            </View>
          ))}
        </View>
      )
  }
}

function open(href: string) {
  if (href.startsWith('/')) router.push(href as Href)
  else void Linking.openURL(href)
}

/** Paragraphe avec gras, italique, code et liens (lien : rôle et libellé annoncés). */
function Rich({
  text,
  strong = false,
  tone,
  variant = 'body',
}: {
  text: Inline[]
  strong?: boolean
  tone?: 'warning'
  variant?: 'body' | 'footnote'
}) {
  return (
    <Text variant={variant} tone={tone} weight={strong ? 'semibold' : undefined}>
      {text.map((s, i) =>
        s.href ? (
          <Text
            key={i}
            variant={variant}
            tone={tone ?? 'brand'}
            weight="semibold"
            accessibilityRole="link"
            accessibilityLabel={t.legal.openLink(s.text)}
            onPress={() => open(s.href!)}
            className="underline"
          >
            {s.text}
          </Text>
        ) : (
          <Text key={i} variant={variant} tone={tone} weight={s.bold || strong ? 'semibold' : undefined} mono={s.code}>
            {s.text}
          </Text>
        ),
      )}
    </Text>
  )
}
