/**
 * Aux design tokens — "Apex".
 *
 * Deep near-black ground, generous corner radius, and one signature device: a
 * heat gradient running black → crimson → amber that sits behind the content
 * and gives every screen its atmosphere. Depth comes from that light and from
 * translucent surfaces floating on it, not from hard rules.
 *
 * Red is still reserved — live, playing, joinable, in sync, on aux — but it now
 * has a second register: `ember`, the amber end of the gradient, which carries
 * heat and energy without claiming "this is live".
 *
 * Type is Archivo throughout, leaning hard on 800 for the big readouts: a
 * number is the loudest thing on a screen, with a small uppercase label above
 * it. That pairing is the other half of the identity.
 *
 * REPLACES "Patchbay" (flat, zero-radius, hard-ruled). Every token NAME from
 * that system survives, so all 66 consumers pick this up without edits; only
 * the values changed, plus the gradient and glow tokens added at the end.
 *
 * `Colors` is the DARK palette and is what a module gets by importing directly.
 * Anything that must follow the user's Dark / Light / System choice reads
 * `useColors()` from '@/lib/theme-context' instead — same key names, so the two
 * are interchangeable at a call site.
 */

import { Platform } from 'react-native';

export const DarkPalette = {
  /** App ground. Near-black with a faint cool cast, so the warm gradient reads
   *  as heat against it rather than as a brown wash. */
  bg: '#0a0910',
  /** Recessed — artwork wells, composer fields. Deeper than the ground. */
  bgRecessed: '#07060c',
  /** Raised card. Sits ON the gradient, so it is a lifted neutral, not black. */
  surface: '#16141e',
  surface2: '#1f1c2a',
  /** Pressed, inactive toggle track. */
  surface3: '#2a2636',
  /** Avatar fill. */
  avatar: '#35303f',
  /** Artwork stand-in glyph. */
  artwork: '#423c4d',

  /** Primary text. */
  ink: '#fbfafc',
  /** Secondary text. */
  ink2: '#a9a4b4',
  /** Tertiary labels. */
  ink3: '#7c7688',

  /** RESERVED. Accent fills. Unchanged from Patchbay — it was already the
   *  right red, and keeping it means the brand survives the redesign. */
  live: '#ec3013',
  /** RESERVED. Accent text on dark — the fill colour fails as small text. */
  liveText: '#ff6a4a',
  /** Text sitting on an accent fill. */
  onLive: '#0a0910',
  danger: '#ff5c7a',

  /** Hairline between list rows. Softer than Patchbay: rules are no longer
   *  doing the separating, so they should whisper. */
  ruleSoft: 'rgba(251,250,252,.07)',
  /** Standard rule. */
  rule: 'rgba(251,250,252,.12)',
  /** Control border. */
  rule2: 'rgba(251,250,252,.20)',
  /** Strong border. */
  rule3: 'rgba(251,250,252,.28)',
  /** Progress track. */
  track: 'rgba(251,250,252,.10)',
  /** Faint lattice, where it is still wanted. */
  grid: 'rgba(251,250,252,.035)',

  liveWash: 'rgba(236,48,19,.16)',
  liveMid: 'rgba(236,48,19,.34)',
  dangerBorder: 'rgba(255,92,122,.45)',
  dangerWash: 'rgba(255,92,122,.12)',
  scrim: 'rgba(7,6,12,.88)',

  /* ------------------------------------------------------ Apex additions */

  /** The amber end of the heat. Energy WITHOUT the "live" claim, so it can be
   *  spent freely where `live` cannot — chart bars, glow, gradient stops. */
  ember: '#ff8a3d',
  /** Ember as small text. */
  emberText: '#ffa463',

  /** Ambient bloom behind artwork and under the accent. */
  glow: 'rgba(236,48,19,.32)',
  glowSoft: 'rgba(236,48,19,.14)',

  /**
   * The signature gradient, as four stops: ground → deep crimson → accent →
   * amber. Kept as individual tokens rather than an array because `Palette`
   * maps every key to `string`; compose them with `gradientStops()` below.
   */
  grad0: '#0a0910',
  grad1: '#3d0a08',
  grad2: '#b4200e',
  grad3: '#ff8a3d',

  /**
   * The inverted card.
   *
   * A warm off-white panel dropped into the dark — the device the references
   * use to make ONE card on a screen unmissable without spending the accent on
   * it. Reserve it for a single element per screen; two competing cream cards
   * cancel each other out.
   */
  cream: '#f2efe9',
  /** Text on cream. Not pure black — that reads as a rendering error on warm white. */
  onCream: '#17161c',
  /** Secondary text on cream. */
  onCream2: '#5d5a63',

  /** The dock capsule and other floating chrome, over content. */
  dock: 'rgba(28,26,36,.82)',
  /** An unselected pill chip. */
  chip: 'rgba(251,250,252,.08)',
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
  bg: '#faf9fb',
  bgRecessed: '#f1eff4',
  /** Cards go pure white and float ON the gradient — the inverse of dark,
   *  where they are a lifted neutral against black. */
  surface: '#ffffff',
  surface2: '#f4f2f7',
  surface3: '#e9e5ee',
  avatar: '#ddd8e4',
  artwork: '#c9c3d1',

  ink: '#14121a',
  ink2: '#4c4757',
  ink3: '#6e6879',

  live: '#cc2510',
  liveText: '#a81800',
  onLive: '#fffdfc',
  danger: '#b01430',

  ruleSoft: 'rgba(20,18,26,.06)',
  rule: 'rgba(20,18,26,.10)',
  rule2: 'rgba(20,18,26,.16)',
  rule3: 'rgba(20,18,26,.24)',
  track: 'rgba(20,18,26,.10)',
  grid: 'rgba(20,18,26,.04)',

  liveWash: 'rgba(236,48,19,.10)',
  liveMid: 'rgba(236,48,19,.22)',
  dangerBorder: 'rgba(176,20,48,.40)',
  dangerWash: 'rgba(176,20,48,.09)',
  scrim: 'rgba(20,18,26,.45)',

  /* ------------------------------------------------------ Apex additions */

  /** Darkened so ember still reads as a colour rather than washing out. */
  ember: '#e8621a',
  emberText: '#b8460f',

  glow: 'rgba(236,48,19,.18)',
  glowSoft: 'rgba(236,48,19,.08)',

  /**
   * The same heat, running the other way: a light ground warming INTO the
   * accent, rather than black igniting into amber. This is what "the dark
   * pixels go light, in the same gradient flow" means in practice — the
   * gradient is the constant, the ground is what inverts.
   */
  grad0: '#faf9fb',
  grad1: '#ffe0cc',
  grad2: '#ff8a5c',
  grad3: '#ec3013',

  /**
   * On light, the inverted card inverts again — it goes DARK. The device is
   * "one card that breaks the ground", not "one card that is cream", so on a
   * light ground the same job needs the opposite value.
   */
  cream: '#17161c',
  onCream: '#f6f4f1',
  onCream2: '#b3aeb8',

  dock: 'rgba(255,255,255,.86)',
  chip: 'rgba(20,18,26,.06)',
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
/**
 * Default corner radius.
 *
 * Deliberately still a plain number: roughly twenty call sites write
 * `borderRadius: Radius`, so changing this single value rounded the entire app
 * in one edit when Patchbay (radius 0) became Apex. Reach for `Radii` below
 * when a specific step is wanted.
 */
export const Radius = 24;

/**
 * The radius scale.
 *
 * `pill` is a deliberate 999 rather than a computed half-height — it survives
 * a row growing a second line of text, where a hardcoded half-height would
 * suddenly look like a rounded rectangle.
 */
export const Radii = {
  /** Inline badges, small tags. */
  sm: 12,
  /** Compact rows, inputs. */
  md: 18,
  /** The default: cards, list rows, artwork tiles. */
  lg: 24,
  /** Hero cards, the Session artwork, sheets. */
  xl: 32,
  /** Buttons, chips, the nav dock, circular icon buttons. */
  pill: 999,
} as const;

/**
 * The floating navigation dock.
 *
 * Not a full-width bar. It hovers above the content with the ground visible on
 * either side and beneath it, which is what makes it read as a control that
 * belongs to the app rather than a border on the screen.
 */
export const Dock = {
  /** Diameter of each circular cell. */
  cell: 52,
  /** Gap between cells inside the dock. */
  gap: 6,
  /** Inner padding of the dock capsule. */
  padding: 8,
  /** How far the dock floats above the safe-area bottom. */
  lift: 14,
} as const;

/** Horizontal pill filters — the `All / Cardio / Muscle` row in the reference. */
export const Chip = {
  height: 40,
  paddingX: 18,
  gap: 8,
} as const;

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
 * Suppresses a platform's default shadow.
 *
 * Apex has depth, but it comes from the gradient and from `glow` — a coloured
 * bloom that belongs to the content — never from a generic grey drop shadow
 * under a card. Use this wherever a platform adds one uninvited.
 */
export const noShadow = Platform.select({
  web: { boxShadow: 'none' },
  android: { elevation: 0 },
  default: { shadowOpacity: 0 },
}) as object;

/* ------------------------------------------------------------- the gradient */

/**
 * The signature heat, ready for `<LinearGradient colors={...} />`.
 *
 * Four stops rather than two: a straight black-to-amber ramp goes muddy through
 * the browns in the middle. The deep crimson at `grad1` holds the shadow end
 * dark for longer, so the accent arrives late and reads as ignition.
 *
 * Pass the palette from `useColors()` so it follows the active theme.
 */
export function gradientStops(c: Palette): readonly [string, string, string, string] {
  return [c.grad0, c.grad1, c.grad2, c.grad3];
}

/**
 * Where the heat comes from.
 *
 * `corner` is the default and matches the direction's reference: light entering
 * from one corner and falling away across the screen, like a light source just
 * off-frame. `vertical` is for wide surfaces where a diagonal would band.
 */
export const GradientDirection = {
  corner: { start: { x: 0.1, y: 0 }, end: { x: 0.9, y: 1 } },
  vertical: { start: { x: 0.5, y: 0 }, end: { x: 0.5, y: 1 } },
  horizontal: { start: { x: 0, y: 0.5 }, end: { x: 1, y: 0.5 } },
} as const;

/**
 * How far up the screen the gradient is allowed to reach.
 *
 * The reference keeps roughly the top third lit and lets the rest fall to
 * ground, which is what stops the effect becoming a wallpaper. Content sits on
 * the dark part; the heat is behind the header.
 */
export const GradientLocations = [0, 0.28, 0.62, 1] as const;

/**
 * The ambient bloom under artwork and accent surfaces.
 *
 * A COLOURED shadow, not a grey one — it reads as light coming off the thing
 * rather than the thing casting onto a surface below it. Android only honours
 * `elevation`, which cannot be tinted, so it gets a slightly stronger elevation
 * as the nearest equivalent.
 */
export function glowShadow(color: string, radius = 24): object {
  return Platform.select({
    web: { boxShadow: `0 8px ${radius}px ${color}` },
    android: { elevation: 8 },
    default: {
      shadowColor: color,
      shadowOpacity: 1,
      shadowRadius: radius,
      shadowOffset: { width: 0, height: 8 },
    },
  }) as object;
}
