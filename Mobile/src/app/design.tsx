import { Droplet, Flame, Fuel, Heart, Navigation, Search } from 'lucide-react-native'
import { useState } from 'react'
import { View } from 'react-native'

import type { SearchResult } from '@/api/schemas'
import { LogoMark } from '@/components/brand/logo'
import { Badge } from '@/components/ui/badge'
import { Banner } from '@/components/ui/banner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ChoiceTile, Chip } from '@/components/ui/choice-tile'
import { Divider } from '@/components/ui/divider'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow, SwitchRow } from '@/components/ui/list-row'
import { OtpInput } from '@/components/ui/otp-input'
import { Screen } from '@/components/ui/screen'
import { Section } from '@/components/ui/section'
import { Skeleton } from '@/components/ui/skeleton'
import { Text, type TextVariant } from '@/components/ui/text'
import { TextField } from '@/components/ui/text-field'
import { toast } from '@/components/ui/toast'
import { ResultCard } from '@/features/search/result-card'
import { haptics } from '@/lib/haptics'
import { elevation } from '@/theme/elevation'
import { useTheme } from '@/theme/theme'
import { tokens } from '@/theme/tokens.generated'

/* Écran de développement : vitrine du design system mobile (non traduit, jamais en production). */

const VARIANTS: TextVariant[] = [
  'display',
  'title1',
  'title2',
  'title3',
  'headline',
  'body',
  'callout',
  'subhead',
  'footnote',
  'caption',
]
const ROLES = [
  'background',
  'surface',
  'card',
  'primary',
  'primary-subtle',
  'secondary',
  'muted',
  'border',
  'border-strong',
  'input',
  'destructive',
  'success',
  'warning',
  'info',
] as const

const sample: SearchResult = {
  station: { id: 'demo', name: 'Station Akpakpa Centre', brand: 'Oryx', location: { lat: 6.37, lng: 2.44 } },
  distanceM: 1200,
  routeDistanceM: 1650,
  durationS: 360,
  quantity: 14,
  stale: true,
  stockUpdatedAt: new Date().toISOString(),
  updatedAgoS: 9 * 3600,
  isOpen: false,
  nextOpening: new Date(Date.now() + 10 * 3600_000).toISOString(),
  servedAt: null,
  reported: true,
}

export default function DesignScreen() {
  const { colors, scheme } = useTheme()
  const [kind, setKind] = useState('lpg')
  const [size, setSize] = useState(2)
  const [code, setCode] = useState('')
  const [on, setOn] = useState(true)
  return (
    <Screen title="Design system" subtitle={`Thème ${scheme} · tokens générés depuis le web`}>
      <View className="flex-row items-center gap-3">
        <LogoMark size={48} />
        <Text variant="title2" weight="bold">
          GoStation
        </Text>
      </View>

      <Heading>Palette de marque</Heading>
      <View className="flex-row overflow-hidden rounded-lg">
        {Object.entries(tokens.brand).map(([k, v]) => (
          <View key={k} className="h-12 flex-1 items-center justify-end pb-1" style={{ backgroundColor: v }}>
            <Text variant="caption" style={{ color: Number(k) >= 500 ? '#fff' : '#411307', fontSize: 9 }}>
              {k}
            </Text>
          </View>
        ))}
      </View>

      <Heading>Rôles</Heading>
      <View className="flex-row flex-wrap gap-2">
        {ROLES.map((r) => (
          <View key={r} className="w-[30%] gap-1">
            <View className="h-10 rounded-md border border-border" style={{ backgroundColor: colors[r] }} />
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {r}
            </Text>
          </View>
        ))}
      </View>

      <Heading>Typographie (Geist)</Heading>
      {VARIANTS.map((v) => (
        <Text key={v} variant={v}>
          {v} · Station la plus proche
        </Text>
      ))}

      <Heading>Boutons (≥ 48 dp)</Heading>
      <Button label="Rechercher" icon={Search} size="lg" onPress={() => haptics.light()} />
      <View className="flex-row gap-2">
        <Button label="Secondaire" variant="secondary" className="flex-1" />
        <Button label="Contour" variant="outline" className="flex-1" />
      </View>
      <View className="flex-row gap-2">
        <Button label="Fantôme" variant="ghost" className="flex-1" />
        <Button label="Supprimer" variant="destructive" className="flex-1" />
      </View>
      <Button label="Chargement" loading />
      <View className="flex-row gap-2">
        <IconButton icon={Heart} label="Favori" selected />
        <IconButton icon={Navigation} label="Itinéraire" floating tone="brand" />
      </View>

      <Heading>Choix</Heading>
      <View className="flex-row gap-3">
        <ChoiceTile icon={Flame} label="Gaz" selected={kind === 'lpg'} onPress={() => setKind('lpg')} />
        <ChoiceTile icon={Fuel} label="Essence" selected={kind === 'petrol'} onPress={() => setKind('petrol')} />
        <ChoiceTile icon={Droplet} label="Gasoil" selected={kind === 'diesel'} onPress={() => setKind('diesel')} />
      </View>
      <View className="flex-row flex-wrap gap-2">
        {['6 kg', '12,5 kg', '25 kg'].map((l, i) => (
          <Chip key={l} label={l} selected={size === i} onPress={() => setSize(i)} />
        ))}
      </View>

      <Heading>Badges et messages</Heading>
      <View className="flex-row flex-wrap gap-2">
        <Badge label="Ouverte" tone="success" />
        <Badge label="À vérifier" tone="warning" />
        <Badge label="Signalée" tone="danger" />
        <Badge label="Info" tone="info" />
        <Badge label="Marque" tone="brand" />
        <Badge label="Neutre" />
      </View>
      <Banner tone="info">Hors connexion : derniers résultats de cette session.</Banner>
      <Banner tone="warning" title="Distances estimées">
        Trajets à vol d’oiseau.
      </Banner>
      <Banner tone="danger">Code incorrect ou expiré.</Banner>
      <Banner tone="success">Signalement envoyé.</Banner>

      <Heading>Résultat de recherche</Heading>
      <View className="-mx-4">
        <ResultCard
          result={sample}
          rank={1}
          unit="cylinder"
          approximate={false}
          selected
          onOpen={() => toast.info('Fiche')}
          onRoute={() => toast.info('Itinéraire')}
        />
      </View>

      <Heading>Formulaires</Heading>
      <TextField label="Adresse email" placeholder="vous@exemple.bj" hint="Aide sous le champ." />
      <TextField label="Mot de passe" secure error="Le mot de passe compte 8 caractères au moins." />
      <OtpInput label="Code" value={code} onChange={setCode} autoFocus={false} />

      <Heading>Listes</Heading>
      <Section title="Compte">
        <ListRow icon={Heart} title="Ligne pressable" subtitle="Avec sous-titre" onPress={() => undefined} />
        <Divider className="ml-14" />
        <SwitchRow title="Interrupteur" value={on} onValueChange={setOn} />
      </Section>

      <Heading>Élévations</Heading>
      <View className="flex-row gap-3">
        {([1, 2, 3] as const).map((l) => (
          <View key={l} className="h-16 flex-1 items-center justify-center rounded-xl bg-popover" style={elevation(l)}>
            <Text variant="footnote">{`Niveau ${l}`}</Text>
          </View>
        ))}
      </View>
      <Card>
        <Text variant="subhead">Carte (élévation 1, rayon 16)</Text>
      </Card>
      <Skeleton height={20} width="60%" />

      <Heading>Retours haptiques</Heading>
      <View className="flex-row flex-wrap gap-2">
        <Button label="Sélection" size="sm" variant="outline" onPress={haptics.selection} />
        <Button label="Succès" size="sm" variant="outline" onPress={haptics.success} />
        <Button label="Alerte" size="sm" variant="outline" onPress={haptics.warning} />
        <Button label="Erreur" size="sm" variant="outline" onPress={haptics.error} />
        <Button label="Toast" size="sm" variant="outline" onPress={() => toast.success('Ajoutée aux favoris')} />
      </View>
    </Screen>
  )
}

function Heading({ children }: { children: string }) {
  return (
    <Text
      variant="footnote"
      weight="semibold"
      tone="muted"
      className="mt-2 uppercase tracking-wide"
      accessibilityRole="header"
    >
      {children}
    </Text>
  )
}
