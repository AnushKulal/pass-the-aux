/**
 * Aux design tokens — "Patchbay".
 *
 * Flat, gridded, zero corner radius, hard rules, Archivo throughout, near-mono
 * red on near-black. Separation is done with rules and ground steps, never with
 * shadows. Red is reserved: it means live, playing, joinable, in sync, on aux —
 * and nothing else.
 *
 * Two themes. Every value here is exact, from
 * design/handoff/design_handoff_aux_mobile/README.md.
 *
 * `Colors` is the DARK palette and is what a module gets by importing directly.
 * Anything that must follow the user's Dark / Light / System choice reads
 * `useColors()` from '@/lib/theme-context' instead — same key names, so the two
 * are interchangeable at a call site.
 */

import { Platform } from 'react-native';

export const DarkPalette = {
  /** App ground. */
  bg: '#0a0908',
  /** Recessed — artwork wells, composer fields. */
  bgRecessed: '#0f0e0d',
  /** Raised — row hover, docked bar. */
  surface: '#141312',
  surface2: '#1c1a19',
  /** Pressed, inactive toggle track. */
  surface3: '#211f1e',
  /** Avatar fill. */
  avatar: '#2d2b2b',
  /** Artwork stand-in glyph. */
  artwork: '#3a3736',

  /** Primary text. */
  ink: '#f3f2f2',
  /** Secondary text — 6.9:1. */
  ink2: '#9b9797',
  /** Tertiary labels — 5.7:1. */
  ink3: '#8a8686',

  /** RESERVED. Accent fills. */
  live: '#ec3013',
  /** RESERVED. Accent text on dark — the fill colour fails as small text. */
  liveText: '#ff563c',
  /** Text sitting on an accent fill. */
  onLive: '#0a0908',
  danger: '#f2657e',

  /** Hairline between list rows. */
  ruleSoft: 'rgba(243,242,242,.10)',
  /** Standard rule. */
  rule: 'rgba(243,242,242,.16)',
  /** Control border. */
  rule2: 'rgba(243,242,242,.24)',
  /** Strong border. */
  rule3: 'rgba(243,242,242,.30)',
  /** Progress track. */
  track: 'rgba(243,242,242,.12)',
  /** 25px modular grid overlay. */
  grid: 'rgba(243,242,242,.045)',

  liveWash: 'rgba(236,48,19,.14)',
  liveMid: 'rgba(236,48,19,.28)',
  dangerBorder: 'rgba(242,101,126,.50)',
  dangerWash: 'rgba(242,101,126,.12)',
  scrim: 'rgba(10,9,8,.86)',
} as const;

/**
 * Both palettes carry exactly the same keys; only the values differ. Annotating
 * the light one as `typeof DarkPalette` would pin every key to the DARK literal
 * — `bg` would have to be the string `'#0a0908'` — so the light values cannot
 * typecheck against it. This mapped type keeps the key set exact (a missing or
 * misspelled token is still an error) while letting the value be any colour
 * string.
 */
export type Palette = { readonly [K in keyof typeof DarkPalette]: string };
export type ColorToken = keyof Palette;

/**
 * The accent DARKENS on light. White on #ec3013 reaches only 3.8:1, which fails
 * on small labels; #ae1800 reaches 6.5:1 and reads stronger on a light ground.
 */
export const LightPalette: Palette = {
  bg: '#f3f2f2',
  bgRecessed: '#eae9e9',
  surface: '#eae7e7',
  surface2: '#e2dfdf',
  surface3: '#d7d3d3',
  avatar: '#d7d3d3',
  artwork: '#bab6b6',

  ink: '#201e1d',
  ink2: '#444141',
  ink3: '#605d5d',

  live: '#ae1800',
  liveText: '#ae1800',
  onLive: '#f3f2f2',
  danger: '#a4152c',

  ruleSoft: 'rgba(32,30,29,.12)',
  rule: 'rgba(32,30,29,.20)',
  rule2: 'rgba(32,30,29,.32)',
  rule3: 'rgba(32,30,29,.42)',
  track: 'rgba(32,30,29,.14)',
  grid: 'rgba(32,30,29,.05)',

  liveWash: 'rgba(236,48,19,.10)',
  liveMid: 'rgba(236,48,19,.24)',
  dangerBorder: 'rgba(164,21,44,.45)',
  dangerWash: 'rgba(164,21,44,.10)',
  scrim: 'rgba(32,30,29,.55)',
};

export const Palettes = { dark: DarkPalette, light: LightPalette } as const;
export type ThemeName = keyof typeof Palettes;
export type ThemeChoice = ThemeName | 'system';

/** Direct-import default. Theme-aware call sites use `useColors()` instead. */
export const Colors = DarkPalette;

/**
 * One typeface. The "measuring voice" is a WEIGHT plus tabular figures, not a
 * second family — there is no mono face in this design.
 */
export const Fonts = {
  regular: 'Archivo_400Regular',
  semibold: 'Archivo_600SemiBold',
  extrabold: 'Archivo_800ExtraBold',
} as const;

/** React Native takes letterSpacing in px; the spec gives em. */
export const tracking = (fontSize: number, em: number) => fontSize * em;

/**
 * Five roles, distinguished by weight and tracking rather than family.
 * Sizes vary per screen — these are the anchors; scale with `display(n)` etc.
 */
export const Type = {
  /** Screen titles, track titles, the wordmark. 800, tight negative tracking. */
  display: (size = 26) => ({
    fontFamily: Fonts.extrabold,
    fontSize: size,
    lineHeight: Math.round(size * 1.06),
    letterSpacing: tracking(size, size >= 64 ? -0.045 : size >= 36 ? -0.03 : -0.02),
  }),
  /** Section titles, button labels. 800, open tracking. */
  heading: (size = 13) => ({
    fontFamily: Fonts.extrabold,
    fontSize: size,
    lineHeight: Math.round(size * 1.25),
    letterSpacing: tracking(size, 0.045),
  }),
  /** All prose. */
  body: (size = 16) => ({
    fontFamily: Fonts.regular,
    fontSize: size,
    lineHeight: Math.round(size * 1.5),
  }),
  /** Metadata, section kickers. Uppercase. */
  label: (size = 11) => ({
    fontFamily: Fonts.semibold,
    fontSize: size,
    lineHeight: Math.round(size * 1.35),
    letterSpacing: tracking(size, 0.12),
    textTransform: 'uppercase' as const,
  }),
  /**
   * Every number that measures: −412ms, 3/5, QUEUE/5, 1:44.
   * Tabular figures keep columns from shifting as digits change.
   */
  readout: (size = 13) => ({
    fontFamily: Fonts.extrabold,
    fontSize: size,
    lineHeight: Math.round(size * 1.2),
    fontVariant: ['tabular-nums'] as const,
  }),
} as const;

export const Space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 44,
} as const;

/**
 * Zero everywhere. This is a defining property of the direction, not an
 * oversight — do not soften a corner because it "looks better".
 */
export const Radius = 0;

/** 1px hairline within a group, 2px between major sections. */
export const Rule = { hair: 1, major: 2 } as const;

/** The modular grid overlay pitch. */
export const GRID = 25;

export const TOUCH_TARGET = 44;

/** 200–320ms, per the spec. */
export const Duration = {
  press: 160,
  enter: 280,
  sheet: 300,
  scrim: 200,
} as const;

/** List entrance stagger, in ms per row. */
export const Stagger = { feed: 55, messages: 50 } as const;

export const Easing = { standard: 'cubic-bezier(.2,.8,.2,1)' } as const;

export const ZIndex = {
  content: 0,
  rail: 10,
  tabBar: 20,
  dock: 25,
  sheet: 30,
  modal: 40,
  toast: 50,
} as const;

/**
 * RN 0.86 deprecated the `pointerEvents` PROP in favour of the style. Constants
 * rather than inline objects so decorative overlays do not allocate per render.
 */
export const PointerEvents = {
  none: { pointerEvents: 'none' },
  boxNone: { pointerEvents: 'box-none' },
  auto: { pointerEvents: 'auto' },
} as const;

/**
 * Elevation is deliberately absent from this direction — separation comes from
 * rules and ground steps. Kept only so the web build can suppress any default
 * platform shadow.
 */
export const noShadow = Platform.select({
  web: { boxShadow: 'none' },
  android: { elevation: 0 },
  default: { shadowOpacity: 0 },
}) as object;
