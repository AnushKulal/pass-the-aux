/**
 * Aux design tokens — "Signal Afterglow".
 *
 * The artwork lights the room, and one line runs through everyone in it.
 * Technical precision — the playhead, the drift readouts, the hairlines — sits
 * inside a warm album-art bloom rather than on cold black.
 *
 * The token NAMES are deliberately unchanged from the previous system so that
 * every component keeps working; only the values moved. See design/SYSTEM.md
 * for the design rationale and the artboards it came from.
 *
 * Dark only. Aux is a night-time, party-context app, and a single palette keeps
 * contrast guarantees provable instead of doubled.
 */

import { Platform } from 'react-native';

export const Colors = {
  /** Ground. Deep indigo-plum — warm-leaning, never neutral grey, never pure black. */
  bg: '#0E0A16',
  /** One step up: list rows, solid blocks. */
  surface: '#140F1E',
  /** Two steps up: pressed states, nested cards. */
  surfaceRaised: '#1C1526',
  /**
   * Non-live interactive fill. Drawn from the bloom's violet and darkened until
   * white text clears 4.5:1 — so primary actions belong to the atmosphere
   * rather than competing with it.
   */
  primary: '#5A3C7A',
  primaryDim: '#3B2751',
  /**
   * THE reserved colour: live, playing, joinable, in sync. It is also the
   * playhead. Nothing decorative may use it — the Feed is scannable precisely
   * because this green-cyan means "something is happening here you can join".
   */
  accent: '#57E2D5',
  accentDim: '#2A8F86',
  /** Primary text. Warm white, not pure. */
  text: '#F2EDF7',
  /** Secondary text, timestamps, metadata. 7.1:1 on bg. */
  muted: '#A79FB8',
  /** Placeholders and dividers ONLY — fails 4.5:1 for readable copy. */
  faint: '#6E6681',
  /** Buffering, adjusting, linked-but-free. Not an error colour. */
  warn: '#E8B15C',
  /** Out of sync, leave, destructive. */
  danger: '#F2657E',
  /** Hairlines. */
  border: 'rgba(255, 255, 255, 0.10)',
  borderBright: 'rgba(255, 255, 255, 0.18)',
  /** Fill for glass surfaces — always sits over the bloom so it tints. */
  glass: 'rgba(255, 255, 255, 0.055)',
  glassStrong: 'rgba(255, 255, 255, 0.09)',
  /** The faint 25px grid, on Session and Feed only. */
  grid: 'rgba(255, 255, 255, 0.028)',
  /** Scrim behind modals. */
  scrim: 'rgba(8, 5, 14, 0.74)',
} as const;

export type ColorToken = keyof typeof Colors;

/**
 * Atmosphere. Derived from album art, DECORATIVE ONLY — these never carry
 * meaning, which is exactly what frees `accent` to be semantic. Vary them per
 * track; they are why every Session looks slightly different.
 */
export const Bloom = {
  a: '#C77FA8',
  b: '#8B5FB0',
  c: '#4A6BA0',
} as const;

/** A radial bloom behind artwork. `size` is the square it occupies. */
export const bloomGradient = (opacity = 0.4) =>
  [
    `rgba(199, 127, 168, ${opacity})`,
    `rgba(139, 95, 176, ${opacity * 0.55})`,
    'rgba(14, 10, 22, 0)',
  ] as const;

/**
 * Three faces, three jobs. Instrument Serif carries the feeling, Figtree does
 * the reading, IBM Plex Mono does the measuring — every number that MEASURES
 * (timecodes, drift, counts, invite codes) is mono. That is the single
 * strongest signal of this direction.
 */
export const Fonts = {
  display: 'InstrumentSerif_400Regular',
  displayItalic: 'InstrumentSerif_400Regular_Italic',
  body: 'Figtree_400Regular',
  bodyMedium: 'Figtree_500Medium',
  bodySemi: 'Figtree_600SemiBold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
} as const;

/** 4px base scale. */
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

export const Radius = {
  /** Data chips, small squares. */
  sm: 6,
  /** Controls. */
  md: 12,
  /** Cards. */
  lg: 18,
  /** Sheets. */
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

/** Explicit z-scale so overlays never fight. Anything not listed sits at 0. */
export const ZIndex = {
  content: 0,
  miniPlayer: 10,
  tabBar: 20,
  sheet: 30,
  modal: 40,
  toast: 50,
} as const;

export const Type = {
  hero: { fontFamily: Fonts.display, fontSize: 40, lineHeight: 44 },
  display: { fontFamily: Fonts.display, fontSize: 32, lineHeight: 37 },
  title: { fontFamily: Fonts.display, fontSize: 24, lineHeight: 29 },
  heading: { fontFamily: Fonts.bodySemi, fontSize: 17, lineHeight: 23 },
  /** 16px floor for body text on mobile. */
  body: { fontFamily: Fonts.body, fontSize: 16, lineHeight: 24 },
  bodyStrong: { fontFamily: Fonts.bodyMedium, fontSize: 16, lineHeight: 24 },
  label: { fontFamily: Fonts.bodyMedium, fontSize: 13.5, lineHeight: 19 },
  caption: { fontFamily: Fonts.body, fontSize: 12.5, lineHeight: 18 },
  /** Timecodes, drift, counts. */
  mono: { fontFamily: Fonts.monoMedium, fontSize: 11.5, lineHeight: 15, letterSpacing: 0.4 },
  /** Uppercase section eyebrows. */
  monoLabel: {
    fontFamily: Fonts.monoMedium,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.9,
    textTransform: 'uppercase' as const,
  },
} as const;

/**
 * React Native 0.86 deprecated the `pointerEvents` PROP in favour of the
 * `pointerEvents` STYLE. Module-level constants rather than inline objects so a
 * decorative overlay does not allocate a new style on every render and defeat
 * the memoisation of whatever it sits inside.
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
  const spec = { sm: [4, 0.3, 2], md: [14, 0.36, 6], lg: [30, 0.44, 14] }[level];
  const [radius, opacity, offset] = spec;

  return Platform.select({
    web: { boxShadow: `0 ${offset}px ${radius}px rgba(6, 3, 12, ${opacity})` },
    android: { elevation: offset },
    default: {
      shadowColor: '#06030C',
      shadowOpacity: opacity,
      shadowRadius: radius,
      shadowOffset: { width: 0, height: offset },
    },
  }) as object;
};
