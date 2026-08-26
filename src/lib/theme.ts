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
  /** App ground. The blobs are what give it depth — it is flat on its own. */
  bg: '#0a0d14',
  /** Recessed: wells, inputs, artwork tiles. */
  bgRecessed: '#0d111a',
  /**
   * THE CARD, AND IT IS TRANSLUCENT.
   *
   * 5.5% white over the ground, so the ambient blobs bleed through every card.
   * That bleed is the direction's whole idea — but it has two failure modes
   * worth knowing before you reach for this token:
   *   a `surface` card inside another `surface` card composites to ~11%, and
   *   a `surface` chip laid over album art goes see-through.
   * Use `surfaceSolid` for either case.
   */
  surface: 'rgba(255,255,255,0.055)',
  /** The pressed state, and the resting fill for chips. */
  surface2: 'rgba(255,255,255,0.09)',
  surface3: 'rgba(255,255,255,0.13)',
  avatar: 'rgba(255,255,255,0.14)',
  /**
   * INVERTS from the previous direction: artwork is now a dark WELL with a
   * faint monogram, not a bright plate. Anything that assumed bright artwork
   * breaks visually rather than at compile time.
   */
  artwork: '#0d111a',
  artInk: 'rgba(255,255,255,0.22)',

  ink: '#f4f6fb',
  ink2: '#a6b0c2',
  ink3: '#828da2',

  /**
   * CORAL — and it means STATE, not action.
   *
   * live · playing · happening · in sync · on aux · unread · PREMIUM · joinable.
   * The rule that governs every screen in this direction:
   *   coral says "this is happening right now"
   *   `pill` (blue) says "you make this happen"
   * Never paint one element in both.
   *
   * JOIN AND SOLO ARE CORAL, AND THIS COMMENT USED TO SAY THE OPPOSITE.
   *
   * It taught "a Join button on a live session — the BUTTON is blue and the
   * BADGE beside it is coral", and every screen that read this file inherited
   * that, so Join shipped blue. The design's own artboards draw it coral, and
   * when the built app reached a phone the first note back was that the feed's
   * Join and Solo pills were the wrong colour.
   *
   * The distinction the old wording missed: blue is not "any action", it is the
   * action that CREATES or CONTROLS — start a session, submit a form, play,
   * skip. Entering something that is already live is not creating anything; it
   * is joining a state that exists without you, and the state colour owns it.
   * Coral on that button is what makes a row of live cards scan as one thing.
   *
   * So: JOIN, SOLO and any other "come into this live thing" control take the
   * coral fill. CREATE, START, PLAY, NEXT and every primary form submit take
   * blue. If you find a comment arguing otherwise, it predates this and is
   * wrong — correct it rather than following it.
   */
  live: '#ff4a2e',
  /** Coral as small text. */
  liveText: '#ff8163',
  /** Warm near-black on a coral fill. Not white — white on coral fails. */
  onLive: '#180703',
  /** Destruction regains its own hue, distinct from both accents. */
  danger: '#ff5f7e',

  ruleSoft: 'rgba(255,255,255,0.055)',
  rule: 'rgba(255,255,255,0.085)',
  rule2: 'rgba(255,255,255,0.13)',
  rule3: 'rgba(255,255,255,0.2)',
  track: 'rgba(255,255,255,0.1)',
  grid: 'rgba(255,255,255,0.03)',

  liveWash: 'rgba(255,74,46,0.15)',
  /** Also the colour of every coral glow. */
  liveMid: 'rgba(255,74,46,0.32)',
  dangerBorder: 'rgba(255,95,126,0.45)',
  dangerWash: 'rgba(255,95,126,0.12)',
  scrim: 'rgba(4,6,11,0.78)',

  /* -------------------------------------------------------------- shadows */

  /**
   * The soft-UI highlight is GONE — deliberately zero rather than deleted.
   *
   * The previous direction lifted surfaces with a light edge up-left and a dark
   * shadow down-right. This one lifts them with a plain drop shadow and a
   * border, so the light half has no job. Kept at zero alpha so the 120 call
   * sites through `raised`/`pressed`/`dropped` keep compiling and simply stop
   * drawing it.
   */
  shadowDark: 'rgba(0,0,0,0.6)',
  shadowLight: 'rgba(255,255,255,0)',
  shadowDrop: 'rgba(0,0,0,0.7)',

  /* -------------------------------------------------- the primary action */

  /**
   * BLUE - and it means CREATE or CONTROL, which is narrower than "action".
   *
   * Every primary CTA, the nav FAB, the play and skip controls, a selected
   * segment, a link. NOT Join and NOT Solo: entering something that is already
   * live belongs to the state accent — see the note on `live`.
   *
   * MEASURED 3.6:1 under white at 15px/600. That is below AA for text this
   * size, and it is the design's own value, kept on purpose: the blue gradient
   * plus its glow is the signature of this direction, and a CTA is a large,
   * unmistakable target rather than something anyone has to read carefully.
   * Deepening to #3a63f0 clears AA and still reads as the same colour if that
   * trade is preferred. The light theme already takes the deeper blue.
   */
  pill: '#4a7dff',
  pillInk: '#ffffff',
  cream: '#4a7dff',
  onCream: '#ffffff',
  onCream2: 'rgba(255,255,255,0.7)',

  /**
   * Two chrome fills doing two different jobs — do not collapse them.
   * `nav` sits BEHIND a blur, so it is translucent.
   * `dock` sits ON artwork with no blur, so it must stay near-opaque or the
   * album cover reads straight through the control.
   */
  nav: 'rgba(16,20,31,0.72)',
  dock: 'rgba(16,20,31,0.92)',
  chip: 'rgba(255,255,255,0.09)',

  /** No vertical wash in this direction; depth comes from the blobs. */
  bgTop: '#0a0d14',
  bgBot: '#0a0d14',

  ember: '#ff4a2e',
  emberText: '#ff8163',
  /** The BLUE glow — under a primary action. */
  glow: 'rgba(74,125,255,0.5)',
  /** The CORAL glow — under something that is live. */
  glowSoft: 'rgba(255,74,46,0.32)',

  /* ------------------------------------------------------------ nocturne */

  /** Top stop of the primary gradient. */
  priTint: '#9ab4ff',
  /**
   * The glass edge. Roughly twice as bright as `rule`, and that delta is
   * precisely what separates a piece of glass from a card — without it the
   * floating nav reads as another surface.
   */
  chromeBorder: 'rgba(255,255,255,0.16)',
  /** The ring punched around a badge so it reads on glass. */
  badgeRing: 'rgba(10,13,20,0.9)',
  /** Far stop of the identity gradient behind an avatar. */
  avatarEnd: '#c0207a',
  /**
   * The wordmark's dot.
   *
   * Equal to `live` here but NOT in light, where the accent turns blue and the
   * dot stays warm - the mark keeps its red full stop in both themes, and it is
   * the last piece of coral the light theme has. Reading `live` for this would
   * quietly turn the logo blue.
   */
  logoDot: '#ff4a2e',
  shadowSheet: 'rgba(0,0,0,0.8)',

  /**
   * The three ambient blobs. They drift slowly behind everything and are the
   * only reason a 5.5%-white card has anything to show through it.
   */
  blobA: 'rgba(122,63,255,0.34)',
  blobB: 'rgba(255,45,120,0.26)',
  blobC: 'rgba(74,125,255,0.3)',

  /** Opaque stand-in for `surface`: card-in-card, or anything over artwork. */
  surfaceSolid: '#161a24',
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
 * The light theme.
 *
 * Nocturne is a dark-only direction — it has no light artboards — so this holds
 * the design's OWN light values, taken from its light theme block rather than
 * derived here. Two things differ structurally from dark and are commented
 * where they appear: artwork stops inverting across themes, and the two
 * accents collapse into one blue.
 */
export const LightPalette: Palette = {
  bg: '#eceef5',
  bgRecessed: '#e3e7f0',
  /** Still translucent, still glass — white at 76% rather than white at 5.5%. */
  surface: 'rgba(255,255,255,0.76)',
  surface2: 'rgba(255,255,255,0.94)',
  surface3: 'rgba(18,22,34,0.09)',
  avatar: 'rgba(18,22,34,0.1)',
  /** A light WELL. Artwork no longer inverts across themes — it is recessed in both. */
  artwork: '#e3e7f0',
  artInk: 'rgba(18,22,34,0.24)',

  ink: '#141824',
  ink2: '#4d566b',
  ink3: '#5f6879',

  /**
   * THE ACCENT COLLAPSE — the design's own light values, kept deliberately.
   *
   * In dark, coral means STATE and blue means ACTION, and no element is ever
   * painted in both. The light artboards drop coral entirely and resolve `live`
   * and `pill` to the SAME blue (#2f5fe0), so in light mode a LIVE badge and a
   * Join button are the same colour and the distinction the whole system rests
   * on stops being visible.
   *
   * This is faithful to the design rather than a mistake in transcription. If
   * the split should hold in both themes, the fix is confined to the four
   * tokens below: a deepened coral (#d63a18 / #b32d0f, with liveWash and
   * liveMid retinted to match) restores it without touching a single screen.
   */
  live: '#2f5fe0',
  liveText: '#1f47b8',
  onLive: '#ffffff',
  danger: '#c62348',

  ruleSoft: 'rgba(18,22,34,0.07)',
  rule: 'rgba(18,22,34,0.11)',
  rule2: 'rgba(18,22,34,0.16)',
  rule3: 'rgba(18,22,34,0.24)',
  track: 'rgba(18,22,34,0.12)',
  grid: 'rgba(18,22,34,0.04)',

  liveWash: 'rgba(47,95,224,0.1)',
  liveMid: 'rgba(47,95,224,0.28)',
  dangerBorder: 'rgba(198,35,72,0.4)',
  dangerWash: 'rgba(198,35,72,0.1)',
  scrim: 'rgba(18,22,34,0.5)',

  /**
   * The highlight is zero in BOTH themes now, which is a real change.
   *
   * Under the old soft-UI model a light surface got its lift almost entirely
   * from a near-opaque white edge (.95) while a dark one got it from the shadow
   * (.032) - a ~30x asymmetry that had to be maintained by hand. The new model
   * lifts everything with one drop shadow plus a border, so neither theme needs
   * the edge and the asymmetry disappears.
   */
  shadowDark: 'rgba(18,22,34,0.4)',
  shadowLight: 'rgba(255,255,255,0)',
  shadowDrop: 'rgba(18,22,34,0.3)',

  /** 4.9:1 under white - the light theme has no contrast debt on its CTA. */
  pill: '#2f5fe0',
  pillInk: '#ffffff',
  cream: '#2f5fe0',
  onCream: '#ffffff',
  onCream2: 'rgba(255,255,255,0.72)',

  nav: 'rgba(255,255,255,0.78)',
  dock: 'rgba(255,255,255,0.94)',
  chip: 'rgba(255,255,255,0.94)',

  bgTop: '#eceef5',
  bgBot: '#eceef5',

  ember: '#2f5fe0',
  emberText: '#1f47b8',
  glow: 'rgba(47,95,224,0.28)',
  glowSoft: 'rgba(47,95,224,0.28)',

  /** Light collapses the gradient to a single stop; there is no tint step. */
  priTint: '#2f5fe0',
  chromeBorder: 'rgba(18,22,34,0.12)',
  badgeRing: 'rgba(255,255,255,0.95)',
  /** Echoes the warm stop the light wordmark keeps - the last coral in the theme. */
  avatarEnd: '#c0341a',
  /** Stays warm while the accent goes blue. See the note on the dark value. */
  logoDot: '#e0341a',
  shadowSheet: 'rgba(18,22,34,0.28)',

  /**
   * Roughly a third of the dark alphas, and all three shift blue. At dark-mode
   * strength these read as stains on a pale ground rather than light behind it.
   */
  blobA: 'rgba(96,110,255,0.13)',
  blobB: 'rgba(64,140,255,0.12)',
  blobC: 'rgba(74,125,255,0.12)',

  /** The opaque composite of `surface` over `bg`, for card-in-card and artwork. */
  surfaceSolid: '#f8fafd',
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
  /** Inset from the frame on each side - the air that makes it an object. */
  inset: 16,
  /** How far it floats clear of the bottom. */
  bottom: 42,
  height: 68,
  radius: 34,
  /** Padding inside the capsule, before the first cell. */
  padding: 14,

  /** Each destination: a 48px round hit area around a 22px glyph. */
  cell: 48,
  icon: 22,

  /** The centre action, lifted out of the capsule so it reads as primary. */
  fab: 60,
  fabLift: 20,
  fabIcon: 26,

  /**
   * DO NOT READ THIS DIRECTLY. Use `useDockReserve()` from '@/lib/dock'.
   *
   * This is the reservation MINUS the device bottom inset, and on its own it is
   * always wrong. The capsule positions itself at `bottom + insets.bottom`, so a
   * screen padding by this number alone leaves `16 - insets.bottom` of clearance:
   * roughly -18px on an iPhone home indicator, -32px on Android three-button
   * navigation. Negative clearance puts the last row of the list under the glass.
   *
   * It was previously called `reserve` and documented as `add insets.bottom`.
   * Ten screens were written against it and nine got that addition wrong,
   * including the Feed - so the name now says it is only half the answer, and
   * the hook that completes it is the only thing that reads it.
   */
  reserveBase: 42 + 68 + 16,
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
  /**
   * One row arriving in a list - the design's `auxRow` at .24s.
   *
   * Shorter than `enter` on purpose: a row is one of many and its entrance is
   * staggered against its neighbours, so the same duration a whole module gets
   * would leave the list still assembling long after the eye has moved on.
   */
  row: 240,
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

/**
 * Raised — the ordinary card.
 *
 * ONE downward shadow with a negative spread, not the offset pair this used to
 * emit. The previous direction lifted a surface by lighting its top-left edge
 * and shadowing its bottom-right, which implied a light source up and to the
 * left. This one lights everything from directly above and lifts by distance
 * alone, so the light half has no job and `shadowLight` sits at zero alpha in
 * both themes.
 *
 * The negative spread is what keeps it from reading as fog: the shadow is
 * pulled 14px narrower than the box before a 34px blur is applied, so it stays
 * under the card instead of haloing out around it.
 *
 * Depth in this direction is shadow AND border together. A raised surface that
 * skips its 1px `rule` edge will read as flat no matter what this returns,
 * because a 5.5%-white card has almost no edge of its own.
 */
export function raised(c: Palette): object {
  return {
    boxShadow: [
      { offsetX: 0, offsetY: 16, blurRadius: 34, spreadDistance: -14, color: c.shadowDark },
    ],
  };
}

/** A heavier lift, for the few surfaces that sit above the rest. */
export function raisedLarge(c: Palette): object {
  return {
    boxShadow: [
      { offsetX: 0, offsetY: 22, blurRadius: 46, spreadDistance: -16, color: c.shadowDark },
    ],
  };
}

/**
 * Recessed — wells, inputs, an unselected segment, a pressed control.
 *
 * Dark half only, for the same reason `raised` dropped its light half. This is
 * now a supporting signal rather than the whole story: the primary cue for a
 * recess in this direction is the FILL (`bgRecessed` for a well, `surface2` for
 * something being pressed), and this adds a little depth under it.
 *
 * Do not reach for it to indicate a pressed state on its own — at these alphas
 * the fill change is what people actually see.
 */
export function pressed(c: Palette): object {
  return {
    boxShadow: [
      { offsetX: 0, offsetY: 2, blurRadius: 10, color: c.shadowDark, inset: true },
    ],
  };
}

/** A shallower recess, for smaller wells where the deep one swallows content. */
export function pressedSoft(c: Palette): object {
  return {
    boxShadow: [
      { offsetX: 0, offsetY: 1, blurRadius: 6, color: c.shadowDark, inset: true },
    ],
  };
}

/**
 * Floating — the nav capsule and the session lobby bar.
 *
 * Deliberately separate from `dropped`: this is the shadow that makes a thing
 * read as an OBJECT hovering over the page rather than a panel resting on it,
 * and it is most of the reason the nav stopped looking like a bar. Pair it with
 * `chromeBorder` all the way around; a floating object with an edge on only one
 * side is a bar again.
 */
export function floating(c: Palette): object {
  return {
    boxShadow: [
      { offsetX: 0, offsetY: 18, blurRadius: 40, spreadDistance: -12, color: c.shadowDrop },
    ],
  };
}

/**
 * The bottom sheet — the one shadow that points UP.
 *
 * A sheet is lit from the page it covers, so its shadow falls onto the content
 * above it. Handing this `dropped()` puts the shadow underneath, off-screen,
 * and the sheet loses its edge against whatever it is covering.
 */
export function sheetShadow(c: Palette): object {
  return {
    boxShadow: [
      { offsetX: 0, offsetY: -10, blurRadius: 60, spreadDistance: -10, color: c.shadowSheet },
    ],
  };
}

/**
 * An ordinary drop shadow, for things genuinely floating ABOVE the page —
 * sheets, the mini player, a toast. Not a raised surface: no light edge, because
 * a floating object is lit by the same source as everything under it.
 */
export function dropped(c: Palette, size: 'sm' | 'md' | 'lg' = 'md'): object {
  const spec = { sm: [6, 16, -6], md: [14, 34, -12], lg: [16, 40, -12] }[size];
  return {
    boxShadow: [
      {
        offsetX: 0,
        offsetY: spec[0],
        blurRadius: spec[1],
        spreadDistance: spec[2],
        color: c.shadowDrop,
      },
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
