import { Text as RNText, type TextProps } from 'react-native'

import { cn } from '@/lib/cn'

export type TextVariant =
  'display' | 'title1' | 'title2' | 'title3' | 'headline' | 'body' | 'callout' | 'subhead' | 'footnote' | 'caption'
export type TextTone =
  'default' | 'muted' | 'brand' | 'onPrimary' | 'onPrimarySubtle' | 'destructive' | 'success' | 'warning' | 'info'
export type TextWeight = 'regular' | 'medium' | 'semibold' | 'bold'

const VARIANT: Record<TextVariant, { size: string; weight: TextWeight }> = {
  display: { size: 'text-display', weight: 'bold' },
  title1: { size: 'text-title1', weight: 'bold' },
  title2: { size: 'text-title2', weight: 'semibold' },
  title3: { size: 'text-title3', weight: 'semibold' },
  headline: { size: 'text-headline', weight: 'semibold' },
  body: { size: 'text-body', weight: 'regular' },
  callout: { size: 'text-callout', weight: 'regular' },
  subhead: { size: 'text-subhead', weight: 'regular' },
  footnote: { size: 'text-footnote', weight: 'regular' },
  caption: { size: 'text-caption', weight: 'medium' },
}

// Familles Geist par graisse (jamais `font-bold` & co : leur font-weight ferait retomber Android sur
// Roboto ; test de non-régression dans text.test.tsx).
export const WEIGHT: Record<TextWeight, string> = {
  regular: 'font-geist',
  medium: 'font-geist-medium',
  semibold: 'font-geist-semibold',
  bold: 'font-geist-bold',
}

const TONE: Record<TextTone, string> = {
  default: 'text-foreground',
  muted: 'text-muted-foreground',
  brand: 'text-brand-text',
  onPrimary: 'text-primary-foreground',
  onPrimarySubtle: 'text-primary-subtle-foreground',
  destructive: 'text-destructive',
  success: 'text-success-subtle-foreground',
  warning: 'text-warning-subtle-foreground',
  info: 'text-info-subtle-foreground',
}

/** Geist Mono (chiffres alignés : horaires, code) n'est embarquée qu'en une graisse (500). */
const MONO = 'font-geist-mono'

/**
 * Classes de taille, de famille et de couleur d'un texte : une seule de chaque. Deux classes de même
 * propriété (famille ou couleur) ne se départagent que par leur ordre dans la feuille générée : la
 * famille passe donc par `weight` / `mono` et la couleur par `tone`, jamais par `className`.
 */
export function textClasses({
  variant = 'body',
  tone = 'default',
  weight,
  mono = false,
}: {
  variant?: TextVariant
  tone?: TextTone
  weight?: TextWeight
  mono?: boolean
}): string {
  const v = VARIANT[variant]
  return cn(v.size, mono ? MONO : WEIGHT[weight ?? v.weight], TONE[tone])
}

/**
 * Texte aux tokens (Geist, une famille par graisse : Android ne synthétise pas les graisses des
 * polices embarquées). Taille dynamique respectée, plafonnée pour garder les écrans utilisables.
 * `className` sert à la mise en page (flex, marges, alignement), pas à la police ni à la couleur.
 */
export function Text({
  variant,
  tone,
  weight,
  mono,
  className,
  maxFontSizeMultiplier = 1.8,
  ...props
}: TextProps & { variant?: TextVariant; tone?: TextTone; weight?: TextWeight; mono?: boolean; className?: string }) {
  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      className={cn(textClasses({ variant, tone, weight, mono }), className)}
      {...props}
    />
  )
}
