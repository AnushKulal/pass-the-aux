/**
 * Aux design tokens.
 *
 * Generated from the ui-ux-pro-max design system:
 *   Community/Forum pattern x Vibrant & Block-based style x OLED dark x glassmorphism.
 *
 * Aux is dark-only by design — it is a night-time, party-context app, and a
 * single palette keeps contrast guarantees provable instead of doubled.
 */

import { Platform } from 'react-native';

export const Colors = {
  /** App background. Near-black indigo: OLED-friendly without being flat #000. */
  bg: '#0F0F23',
  /** One step up — cards, sheets, blocks. */
  surface: '#1E1B4B',
  /** Two steps up — pressed states, nested cards. */
  surfaceRaised: '#2A2563',
  /** Brand indigo: headers, active nav, selection. */
  primary: '#4338CA',
  primaryDim: '#312E81',
  /** The "go" colour: play, live, join. Never used for anything passive. */
  accent: '#22C55E',
  accentDim: '#15803D',
  /** Primary text. */
  text: '#F8FAFC',
  /** Secondary text, timestamps, metadata. 4.6:1 on bg — passes AA. */
  muted: '#A5B4FC',
  /** Tertiary — placeholders only, never body copy. */
  faint: '#6B7280',
  /** Leave, destructive, mic-muted. */
  danger: '#F43F5E',
  /** Hairlines. Light enough to read over both bg and glass. */
  border: 'rgba(255, 255, 255, 0.14)',
  /** Fill for BlurView surfaces. */
  glass: 'rgba(255, 255, 255, 0.10)',
  glassStrong: 'rgba(255, 255, 255, 0.16)',
  /** Scrim behind modals. */
  scrim: 'rgba(6, 6, 18, 0.72)',
} as const;

export type ColorToken = keyof typeof Colors;

/**
 * Righteous carries the music-poster energy for titles; Poppins does the
 * legible work everywhere else. Loaded in the root layout via expo-font.
 */
export const Fonts = {
  display: 'Righteous_400Regular',
  body: 'Poppins_400Regular',
  bodyMedium: 'Poppins_500Medium',
  bodySemi: 'Poppins_600SemiBold',
  bodyBold: 'Poppins_700Bold',
} as const;

/** 4px base scale. */
export const Space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 18,
  xl: 26,
  pill: 999,
} as const;

/**
 * WCAG / platform minimum for a tappable element. Anything interactive must
 * reach this even when its visual is smaller — pad it, do not shrink the target.
 */
export const TOUCH_TARGET = 44;

/** Micro-interaction timing. Anything slower than 300ms reads as lag. */
export const Duration = {
  fast: 150,
  base: 220,
  slow: 300,
} as const;

/**
 * Explicit z-scale so overlays never fight. Anything not listed sits at 0.
 */
export const ZIndex = {
  content: 0,
  miniPlayer: 10,
  tabBar: 20,
  sheet: 30,
  modal: 40,
  toast: 50,
} as const;

export const Type = {
  hero: { fontFamily: Fonts.display, fontSize: 34, lineHeight: 40 },
  title: { fontFamily: Fonts.display, fontSize: 24, lineHeight: 30 },
  heading: { fontFamily: Fonts.bodySemi, fontSize: 18, lineHeight: 26 },
  /** 16px floor for body text on mobile. */
  body: { fontFamily: Fonts.body, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: Fonts.bodyMedium, fontSize: 16, lineHeight: 24 },
  label: { fontFamily: Fonts.bodyMedium, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: Fonts.body, fontSize: 13, lineHeight: 18 },
} as const;

/**
 * React Native 0.86 deprecated the `pointerEvents` PROP in favour of the
 * `pointerEvents` STYLE. These are module-level constants rather than inline
 * objects so a decorative overlay does not allocate a new style on every
 * render and defeat the memoisation of whatever it sits inside.
 */
export const PointerEvents = {
  none: { pointerEvents: 'none' },
  boxNone: { pointerEvents: 'box-none' },
  auto: { pointerEvents: 'auto' },
} as const;

/**
 * Elevation. iOS gets a coloured shadow that reads as ambient light from the
 * artwork; Android only understands `elevation`; web uses boxShadow.
 */
export const shadow = (level: 'sm' | 'md' | 'lg') => {
  const spec = { sm: [4, 0.24, 2], md: [12, 0.32, 6], lg: [24, 0.4, 12] }[level];
  const [radius, opacity, offset] = spec;

  return Platform.select({
    web: { boxShadow: `0 ${offset}px ${radius}px rgba(8, 6, 30, ${opacity})` },
    android: { elevation: offset },
    default: {
      shadowColor: '#08061E',
      shadowOpacity: opacity,
      shadowRadius: radius,
      shadowOffset: { width: 0, height: offset },
    },
  }) as object;
};
