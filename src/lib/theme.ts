/**
 * Aux design tokens — soft UI, from `design/v2/aux-v2.dc.html`.
 *
 * A cool grey ground with every surface RAISED off it: one dark shadow down and
 * right, one light shadow up and left, as though lit from the top-left corner.
 * Pressed and recessed things use the same pair inverted. Separation is done
 * with light, not with rules and not with flat colour steps — which is why the
 * border tokens survive but should keep shrinking as components are rebuilt.
 *
 * Archivo throughout, at 400/600/800 only.
 *
 * Red is reserved: live, playing, joinable, in sync, on aux, unread, selected.
 * It is also now the ONLY alarm colour — destructive actions are a red outline
 * rather than a second hue.
 *
 * This replaces two earlier directions ("Patchbay", flat and zero-radius, then
 * "Apex", a heat gradient). Every token NAME from both survives, so all 72
 * consumers pick this up with no edits of their own — only the values moved.
 *
 * `Colors` is the DARK palette and is what a module gets by importing directly.
 * Anything that must follow the user's Dark / Light / System choice reads
 * `useColors()` from '@/lib/theme-context' instead — same key names, so the two
 * are interchangeable at a call site.
 */

import { Platform } from 'react-native';

/*
 * ---------------------------------------------------------------------------
 * SOURCE OF TRUTH: design/v2/aux-v2.dc.html
 *
 * Two deliberate deviations from that file, both worth knowing about:
 *
 * 1. `ink3` is lightened. The design ships #757B85 / #868C96, which measure
 *    3.52:1 and 3.15:1 against the card — below WCAG AA — and it is the most
 *    used colour in the app (176 sites), including 9.5px tab labels. The values
 *    here clear 4.5:1. Raise with the designer rather than silently reverting.
 *
 * 2. `danger` no longer has its own hue. The design has ONE alarm colour, and
 *    destructive actions are drawn as a `live` outline with `liveText` on top.
 *    The token survives so its 25 call sites keep compiling.
 * ---------------------------------------------------------------------------
 */
export const DarkPalette = {
  /** App ground — the gradient's middle stop. */
  bg: '#1e2128',
  /** Recessed: wells, inputs, the inside of a pressed control. */
  bgRecessed: '#1a1d23',
  /** The card. The most common surface in the design. */
  surface: '#23272e',
  surface2: '#262a31',
  /** Top of the ladder: recess < nav < card < card2 < surface3. */
  surface3: '#2c313a',
  avatar: '#2c313a',
  /**
   * INVERTS between themes — near-WHITE on dark, near-black on light.
   * Artwork is a bright tile here, not a dark well, so anything drawn on it
   * must use `artInk` rather than `ink`, or it disappears.
   */
  artwork: '#edeff2',
  /** The only ink that reads on `artwork`. */
  artInk: 'rgba(30,34,41,.42)',

  ink: '#edeff2',
  ink2: '#8e949e',
  /** Lightened from the design's #757b85 for contrast — see the note above. */
  ink3: '#8a9099',

  /** RESERVED: live, playing, joinable, in sync, on aux, unread, selected. */
  live: '#ec3013',
  /** The accent as small text — the fill fails at label sizes. */
  liveText: '#ff563c',
  /** WHITE, in both themes: the design sets #fff on every accent fill. */
  onLive: '#ffffff',
  /** One alarm colour. Destructive = a `live` outline with `liveText` on it. */
  danger: '#ec3013',

  ruleSoft: 'rgba(237,239,242,.06)',
  rule: 'rgba(237,239,242,.1)',
  /**
   * Controls in this design carry shadows, not borders. These two survive for
   * the call sites that still draw a border, and should fall away as each
   * component is rebuilt on the shadow recipes.
   */
  rule2: 'rgba(237,239,242,.14)',
  rule3: 'rgba(237,239,242,.20)',
  /** Unplayed waveform bar. Not text, so it takes the design's raw value. */
  track: '#757b85',
  grid: 'rgba(237,239,242,.03)',

  liveWash: 'rgba(236,48,19,.14)',
  liveMid: 'rgba(236,48,19,.30)',
  dangerBorder: '#ec3013',
  dangerWash: 'rgba(236,48,19,.10)',
  /** Behind sheets. The one colour the design keeps identical across themes. */
  scrim: 'rgba(0,0,0,.5)',

  /* ------------------------------------------------------- the two shadows */

  /**
   * THE MOST IMPORTANT PAIR IN THIS FILE.
   *
   * Every raised surface is one dark shadow down-right and one light shadow
   * up-left, as if lit from the top-left. Note the ~30x alpha asymmetry against
   * the light theme: on a dark ground the highlight is almost subliminal
   * (.032), because a bright edge on dark reads as a glow rather than a lit
   * surface. Copying the light theme's .95 here would look like neon piping.
   */
  shadowDark: 'rgba(0,0,0,.46)',
  shadowLight: 'rgba(255,255,255,.032)',
  /** Ordinary drop shadow, for things genuinely floating above the page. */
  shadowDrop: 'rgba(0,0,0,.42)',

  /* ------------------------------------------------------- inverted button */

  /** Primary action fill — near-white on dark, near-black on light. */
  pill: '#f1f3f6',
  pillInk: '#1e2229',
  /** Kept as the older name for the same device. */
  cream: '#f1f3f6',
  onCream: '#1e2229',
  onCream2: 'rgba(30,34,41,.65)',

  /** The tab bar. Darker than a card, so the bar reads as behind the content. */
  nav: '#1b1e24',
  dock: '#1b1e24',
  /** An unselected chip — the recessed value. */
  chip: '#1a1d23',

  /* ------------------------------------------------------------- gradient */

  /** The ground is a three-stop vertical wash, not a flat fill. */
  bgTop: '#272c34',
  bgBot: '#191c21',

  /**
   * Deprecated with the Apex direction, which had a second amber accent. Held
   * as aliases of `live` so nothing breaks and nothing drifts off-palette.
   */
  ember: '#ec3013',
  emberText: '#ff563c',
  /** INVERTS: a LIGHT bloom on dark, a dark one on light. */
  glow: 'rgba(237,239,242,.15)',
  glowSoft: 'rgba(237,239,242,.08)',
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
  bg: '#f3f5f8',
  bgRecessed: '#e6e9ef',
  surface: '#f5f7fa',
  surface2: '#f8fafc',
  surface3: '#dce1e8',
  avatar: '#dce1e8',
  /** Inverts with the theme: a DARK tile on a light ground. */
  artwork: '#242830',
  artInk: 'rgba(241,243,246,.5)',

  ink: '#1b1e24',
  ink2: '#5d636d',
  /** Lightened from the design's #868c96 for contrast. */
  ink3: '#6f757f',

  /** Darker on light: #ec3013 under white text reaches only 3.9:1. */
  live: '#c41f08',
  liveText: '#ae1800',
  onLive: '#ffffff',
  danger: '#c41f08',

  ruleSoft: 'rgba(27,30,36,.07)',
  rule: 'rgba(27,30,36,.12)',
  rule2: 'rgba(27,30,36,.16)',
  rule3: 'rgba(27,30,36,.22)',
  track: '#868c96',
  grid: 'rgba(27,30,36,.03)',

  liveWash: 'rgba(196,31,8,.10)',
  liveMid: 'rgba(196,31,8,.24)',
  dangerBorder: '#c41f08',
  dangerWash: 'rgba(196,31,8,.08)',
  scrim: 'rgba(0,0,0,.5)',

  /**
   * The highlight is nearly opaque here (.95) against .032 on dark. On a light
   * ground the raised look comes from the WHITE edge; on a dark one it comes
   * almost entirely from the shadow. Swapping these is the classic way to make
   * neumorphism look wrong in one theme.
   */
  shadowDark: 'rgba(30,34,41,.13)',
  shadowLight: 'rgba(255,255,255,.95)',
  shadowDrop: 'rgba(30,34,41,.15)',

  pill: '#1e2229',
  pillInk: '#f1f3f6',
  cream: '#1e2229',
  onCream: '#f1f3f6',
  onCream2: 'rgba(241,243,246,.65)',

  nav: '#edf0f4',
  dock: '#edf0f4',
  chip: '#e6e9ef',

  bgTop: '#ffffff',
  bgBot: '#e9ecf1',

  ember: '#c41f08',
  emberText: '#ae1800',
  glow: 'rgba(30,34,41,.13)',
  glowSoft: 'rgba(30,34,41,.07)',
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
  xxxl: 28,
  huge: 40,
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
export const Radius = 18;

/**
 * The radius scale.
 *
 * `pill` is a deliberate 999 rather than a computed half-height — it survives
 * a row growing a second line of text, where a hardcoded half-height would
 * suddenly look like a rounded rectangle.
 */
export const Radii = {
  /** Tab tiles, the smallest raised things. */
  xs: 11,
  /** Inline badges, small tags. */
  sm: 12,
  /** Compact rows. */
  md: 14,
  /** The house corner: cards, list rows, artwork tiles. */
  lg: 18,
  /** Larger cards. */
  xl: 22,
  /** The top of a sheet. */
  xxl: 28,
  /** Primary buttons — squarer than a full pill in this design. */
  button: 16,
  /** Avatars, the live dot, anything genuinely circular. */
  pill: 999,
} as const;

/**
 * The floating navigation dock.
 *
 * Not a full-width bar. It hovers above the content with the ground visible on
 * either side and beneath it, which is what makes it read as a control that
 * belongs to the app rather than a border on the screen.
 */
/**
 * The bottom navigation.
 *
 * NOTE THE SHAPE CHANGE: this design's nav is a full-width 88px bar carrying a
 * labelled tile per destination, not the floating capsule the previous
 * direction used. `cell` / `gap` / `padding` / `lift` are kept alive so the
 * current dock keeps compiling until it is rebuilt; `height` and below are the
 * design's real numbers.
 */
export const Dock = {
  /** Tile size in the bar, and the metrics the old floating dock used. */
  cell: 34,
  gap: 6,
  padding: 0,
  lift: 0,

  /** Full bar height, before the safe-area inset. */
  height: 88,
  bottomPad: 12,
  /** Corner on each destination tile. */
  tileRadius: 11,
  labelSize: 9.5,
} as const;

/** Horizontal filter chips. */
export const Chip = {
  height: 44,
  paddingX: 18,
  gap: 6,
} as const;

/** Bottom sheets — the queue, the chat, the attach picker. */
export const Sheet = {
  radius: 28,
  grabberW: 40,
  grabberH: 4,
  /** Fraction of screen height a sheet may occupy. */
  maxHeight: 0.74,
} as const;

/** 1px hairline within a group, 2px between major sections. */
export const Rule = { hair: 1, thick: 1.5, major: 2 } as const;

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

/* ------------------------------------------------------------ soft UI depth */

/**
 * The raised and pressed surfaces this design is built from.
 *
 * WHY THIS WORKS AT ALL: React Native's legacy shadow props allow exactly one
 * shadow, and Android's `elevation` cannot be tinted or offset — so the paired
 * light-and-dark shadow that defines soft UI was impossible until RN 0.76 added
 * the CSS-like `boxShadow` prop, which takes an ARRAY and supports `inset`.
 * This project is on the New Architecture, which is that prop's requirement.
 *
 * THE FLOOR: outset shadows need Android 9+, inset shadows Android 10+. This
 * app's minSdk is 24 (Android 7), so on 7–9 these degrade to nothing and the
 * surfaces render flat. That is acceptable — flat is the old design, and it is
 * legible — but it means the look is not universal and should not be the only
 * thing distinguishing two states. Pair any raised/pressed distinction that
 * carries MEANING with a colour or position change as well.
 *
 * Light comes from the top-left in every recipe. Keep it that way: mixed light
 * sources are what make soft UI look like a mistake rather than a surface.
 */

/** The standard raised surface — cards, controls, tiles. Used ~34× in the design. */
export function raised(c: Palette): object {
  return {
    boxShadow: [
      { offsetX: 5, offsetY: 5, blurRadius: 12, color: c.shadowDark },
      { offsetX: -4, offsetY: -4, blurRadius: 10, color: c.shadowLight },
    ],
  };
}

/** A heavier lift, for the few surfaces that sit above the rest. */
export function raisedLarge(c: Palette): object {
  return {
    boxShadow: [
      { offsetX: 6, offsetY: 6, blurRadius: 16, color: c.shadowDark },
      { offsetX: -5, offsetY: -5, blurRadius: 13, color: c.shadowLight },
    ],
  };
}

/**
 * Recessed — wells, inputs, an unselected segment, a pressed control.
 *
 * The same pair as `raised`, inverted. Reuse it for the pressed STATE of a
 * raised control: the surface appearing to sink under a finger is the whole
 * idiom, and it costs no extra tokens.
 */
export function pressed(c: Palette): object {
  return {
    boxShadow: [
      { offsetX: 4, offsetY: 4, blurRadius: 10, color: c.shadowDark, inset: true },
      { offsetX: -3, offsetY: -3, blurRadius: 8, color: c.shadowLight, inset: true },
    ],
  };
}

/** A shallower recess, for smaller wells where the deep one swallows content. */
export function pressedSoft(c: Palette): object {
  return {
    boxShadow: [
      { offsetX: 3, offsetY: 3, blurRadius: 8, color: c.shadowDark, inset: true },
      { offsetX: -2, offsetY: -2, blurRadius: 6, color: c.shadowLight, inset: true },
    ],
  };
}

/**
 * An ordinary drop shadow, for things genuinely floating ABOVE the page —
 * sheets, the mini player, a toast. Not a raised surface: no light edge, because
 * a floating object is lit by the same source as everything under it.
 */
export function dropped(c: Palette, size: 'sm' | 'md' | 'lg' = 'md'): object {
  const spec = { sm: [3, 8], md: [10, 24], lg: [12, 32] }[size];
  return {
    boxShadow: [
      { offsetX: 0, offsetY: spec[0], blurRadius: spec[1], color: c.shadowDrop },
    ],
  };
}

/**
 * The ambient bloom under artwork, the play circle and the intro mark.
 *
 * A COLOURED shadow, not a grey one: it reads as light coming off the thing
 * rather than the thing casting onto a surface below it. That is the whole
 * difference from `dropped`, which is why the colour is a parameter here and a
 * palette lookup there — pass `C.glow` unless you have a specific reason.
 *
 * This replaces the old `glowShadow()`, which belonged to the abandoned heat
 * direction and, worse, silently swapped the tint for an untinted
 * `elevation: 8` on Android. The `boxShadow` array is honoured on every target
 * this app ships to, so the bloom is now the same light everywhere.
 *
 * Sizes are the artboard's own: `md` is the play circle and the lounge hero
 * tile, `lg` is the Session artwork and the intro mark, `sm` is for anything
 * small enough that the large blur would read as fog.
 */
export function bloom(color: string, size: 'sm' | 'md' | 'lg' = 'md'): object {
  const spec = { sm: [8, 24], md: [16, 42], lg: [26, 70] }[size];
  return {
    boxShadow: [{ offsetX: 0, offsetY: spec[0], blurRadius: spec[1], color }],
  };
}
