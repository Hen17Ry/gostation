/**
 * Tailwind (NativeWind v4) : uniquement les tokens de GoStation. Les couleurs sont des rôles
 * sémantiques (variables posées par le thème, clair ou sombre selon le système), générés depuis le
 * design system web (scripts/gen-tokens.mts) ; la palette Tailwind par défaut est remplacée.
 */
const { platformSelect } = require('nativewind/theme')

const { tokens } = require('./src/theme/tokens.cjs')

const role = (name) => `rgb(var(--${name}) / <alpha-value>)`
const roles = Object.fromEntries(Object.keys(tokens.light).map((k) => [k, role(k)]))

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    colors: {
      transparent: 'transparent',
      white: '#ffffff',
      black: '#000000',
      brand: tokens.brand,
      neutral: tokens.neutral,
      ...roles,
    },
    // Échelle typographique mobile (dp) : corps 16, minimum 12 ; interligne ≈ 1,3 à 1,5.
    fontSize: {
      caption: ['12px', { lineHeight: '16px' }],
      footnote: ['13px', { lineHeight: '18px' }],
      subhead: ['14px', { lineHeight: '20px' }],
      callout: ['15px', { lineHeight: '20px' }],
      body: ['16px', { lineHeight: '24px' }],
      headline: ['17px', { lineHeight: '22px' }],
      title3: ['20px', { lineHeight: '26px' }],
      title2: ['24px', { lineHeight: '30px' }],
      title1: ['28px', { lineHeight: '34px' }],
      display: ['34px', { lineHeight: '40px' }],
    },
    // Une famille par graisse (Android ne synthétise pas les graisses d'une police embarquée) :
    // nom du fichier sous Android, nom PostScript sous iOS. Clés distinctes des utilitaires de
    // graisse (`font-bold`…) : leur `font-weight` ferait retomber Android sur Roboto ; et pas `sans`
    // ni `mono`, que le preset NativeWind redéfinit (polices système) dans theme.extend.
    fontFamily: {
      geist: [platformSelect({ ios: 'Geist-Regular', default: 'Geist_400Regular' })],
      'geist-medium': [platformSelect({ ios: 'Geist-Medium', default: 'Geist_500Medium' })],
      'geist-semibold': [platformSelect({ ios: 'Geist-SemiBold', default: 'Geist_600SemiBold' })],
      'geist-bold': [platformSelect({ ios: 'Geist-Bold', default: 'Geist_700Bold' })],
      'geist-mono': [platformSelect({ ios: 'GeistMono-Medium', default: 'GeistMono_500Medium' })],
    },
    borderRadius: {
      none: '0px',
      xs: '4px',
      sm: '6px',
      md: '10px',
      lg: '12px',
      xl: '16px',
      '2xl': '20px',
      '3xl': '28px',
      full: '9999px',
    },
    extend: {},
  },
  plugins: [],
}
