/**
 * The card — and in this direction the name finally stops being a lie.
 *
 * Built from `design/nocturne/aux-nocturne.dc.html`, which declares the recipe
 * once as `--g` / `--gb` / `--sh` (L34) and then spends it 112 times: L82 (the
 * intro's quote card), L272 (the feed's empty card), L399 (a lounge row), L820
 * (the profile's "listening right now" card, with the bleed).
 *
 * THE RECIPE IS THREE THINGS AND ALL THREE ARE LOAD-BEARING:
 *   a translucent `surface` fill, so the ambient blobs behind the app bleed
 *   through and the card has any life at all;
 *   a 1px `rule` hairline, because 5.5% white has no edge of its own;
 *   and `raised()`.
 * Drop the border and the card reads FLAT no matter what shadow it carries —
 * that is the single most common way this direction gets rendered wrong.
 *
 * IS IT ACTUALLY TRANSLUCENT? MEASURED, because "glass" is exactly the kind of
 * claim that stays true in the file and goes false on the screen. Dark mode,
 * over the brightest part of an ambient blob:
 *
 *   the ground alone        #0a0d14      ->  under the blob   rgb(48,30,100)
 *   the same, through this  rgb(23,26,33) ->  rgb(59,42,108)
 *
 * a 36/16/75 shift — a card you can see light through, not a grey plate. So the
 * fill is right, and every way this direction fails is the GROUND going missing
 * instead. Two of them, both silent:
 *   - a screen inside `(tabs)` that forgets `ground={false}` paints an opaque
 *     `bg` over the blobs mounted once behind the navigator (see `Screen`);
 *   - the blobs not reaching the middle of the screen at all. That one WAS
 *     happening; `ambient-ground.tsx` has the post-mortem in its header.
 *
 * Light mode is deliberately much quieter — its card is 76% white and its blobs
 * are a third of the dark alphas, so the same measurement moves about 4/255.
 * That is the palette matching the light artboard, not a bug to fix here.
 *
 * TWO SIZES, and the design is perfectly consistent about which is which: every
 * one of its 43 radius-24 surfaces carries `--sh`, and not one of its 54
 * radius-18 surfaces does. So the corner is not a taste knob — 24 means "a card
 * standing on the page", 18 means "a row inside something else, sitting flat".
 *
 * This file used to hold a flat, square, shadowless panel and argued that there
 * was "no glass in this direction". That was true of Patchbay. It is the
 * opposite of true here.
 */

import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useColors } from '@/lib/theme-context';
import { PointerEvents, Radii, Rule, Space, raised } from '@/lib/theme';

/**
 * The design's card corner, and `Radii` has no step for it — `xl` is 22 and
 * `xxl` is 28, and both are visibly wrong beside a 24 in the same column. Held
 * locally rather than rounded to a neighbour; the token layer wants a
 * `Radii.card = 24` and this constant disappears the day it lands.
 */
const CARD_RADIUS = 24;

/** The top-right radial bleed: a 180px disc whose centre sits 50px inside the corner. */
const BLEED_INSET = 50;
/** Solid core, then the fade. Together they reproduce the design's 180px circle. */
const BLEED_CORE = 45;
const BLEED_FADE = 110;

export type GlassCardVariant =
  /** Radius 24 + `raised()`. A card standing on the page. */
  | 'card'
  /** Radius 18, no shadow. A row inside a list, or a panel inside a card. */
  | 'row';

/** The corner bleed. `live` is a coral wash, `pri` a blue one — see the accent rule. */
export type GlassCardGlow = 'live' | 'pri';

export type GlassCardTone =
  | 'default'
  /** `liveWash` fill behind a `liveMid` edge: this card is happening right now. */
  | 'live';

export type GlassCardProps = {
  children: ReactNode;
  /** Placement — margins, width, flex. The card's own skin is not overridable. */
  style?: StyleProp<ViewStyle>;
  variant?: GlassCardVariant;
  tone?: GlassCardTone;
  /**
   * OPAQUE FILL. Reach for this whenever the translucent one cannot work:
   * a card nested in another card (5.5% over 5.5% composites to ~11% and the
   * inner one stops being a separate object), anything laid over artwork, and
   * anything inside a `BlurView`. It is the resolved composite of `surface`
   * over `bg`, so it looks identical anywhere the ground behind it is plain.
   */
  solid?: boolean;
  /**
   * The radial bleed in the top-right corner (design L303 blue, L822 coral).
   * Coral says the card is LIVE; blue says the card is something you can do.
   * Never both, and never on a card that is neither.
   */
  glow?: GlassCardGlow;
  padded?: boolean;
  /**
   * @deprecated A card IS glass here — it is simply not BLURRED, and the
   * difference is the direction rather than a quibble. The design blurs exactly
   * five surfaces: the nav, the mini-player, the sheet, the toast and the lobby
   * bar. A card is none of them, and blurring one would smear the ambient blobs
   * it exists to show through, which is the effect itself.
   *
   * This note used to open "Cards are not glass", which is how the whole
   * direction gets read as absent — the translucency IS the glass, the blur is
   * only chrome's share of it. Accepted and ignored so old call sites compile.
   */
  intensity?: number;
};

export type PanelProps = GlassCardProps;

export function GlassCard({
  children,
  style,
  variant = 'card',
  tone = 'default',
  solid = false,
  glow,
  padded = true,
}: GlassCardProps) {
  const C = useColors();
  const isCard = variant === 'card';
  const live = tone === 'live';

  const radius = isCard ? CARD_RADIUS : Radii.lg;

  const skin: ViewStyle = {
    borderRadius: radius,
    backgroundColor: live ? C.liveWash : solid ? C.surfaceSolid : C.surface,
    borderColor: live ? C.liveMid : C.rule,
  };

  const body = (
    <>
      {glow ? <Bleed color={glow === 'live' ? C.glowSoft : C.glow} /> : null}
      {children}
    </>
  );

  /*
    No bleed, no clip, no wrapper — the overwhelmingly common case stays a
    single View. `raised()` is spread rather than merged so a caller's `style`
    can still replace the shadow outright if it has to.
  */
  if (!glow) {
    return (
      <View
        style={[
          styles.base,
          skin,
          isCard && raised(C),
          padded && (isCard ? styles.paddedCard : styles.paddedRow),
          style,
        ]}>
        {body}
      </View>
    );
  }

  /*
    THE SHADOW HAS TO LIVE ON AN OUTER VIEW.

    Clipping the bleed needs `overflow: 'hidden'`, and Android clips a view's
    own boxShadow away with it — the card would silently lose its lift on one
    platform only. So the glow case splits into a shadow shell around a clipped
    skin. `style` goes on the shell because it is documented as placement.
  */
  return (
    <View style={[{ borderRadius: radius }, isCard && raised(C), style]}>
      <View
        style={[
          styles.base,
          styles.clip,
          skin,
          padded && (isCard ? styles.paddedCard : styles.paddedRow),
        ]}>
        {body}
      </View>
    </View>
  );
}

/** The name this component should be called by from here on. */
export const Panel = GlassCard;

/**
 * The corner bleed, drawn as a shadow rather than a gradient.
 *
 * React Native has no `radial-gradient` and no element-level blur, so the
 * design's `radial-gradient(circle, rgba(...), transparent 70%)` has to be
 * reproduced some other way. A zero-size view with a wide, zero-offset,
 * positively-spread `boxShadow` IS that gradient: the spread paints a solid
 * disc, the blur feathers it to nothing, and the box that casts it has no area
 * to leave a hole in the middle. That is strictly cheaper than mounting
 * `react-native-svg` (currently imported nowhere in the app) for a decoration,
 * and it keeps every soft edge in the codebase on the same primitive.
 *
 * `bloom()` cannot stand in: every recipe in the theme offsets its shadow
 * downward, and this one has to be centred or the disc slides off the corner.
 *
 * Colour comes from the glow tokens, so a bleed can never invent a hue. They
 * run slightly hotter than the artboard (`glow` is .5 against the design's .35)
 * — under a 110px blur the difference is a shade, and a token beats a literal.
 */
function Bleed({ color }: { color: string }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.bleed,
        PointerEvents.none,
        {
          boxShadow: [
            { offsetX: 0, offsetY: 0, blurRadius: BLEED_FADE, spreadDistance: BLEED_CORE, color },
          ],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: Rule.hair,
  },
  clip: {
    overflow: 'hidden',
  },
  /** The design's own card padding, and its most frequent one by a wide margin. */
  paddedCard: {
    padding: Space.lg,
  },
  /**
   * The design's rows run 13–14px, which falls between `Space.md` and
   * `Space.lg`. 12 is the nearer step and the one the rest of the kit's compact
   * rows already use, so a `row` card lines up with them.
   */
  paddedRow: {
    padding: Space.md,
  },
  /*
    1×1 rather than 0×0. An outset shadow is clipped to OUTSIDE the box that
    casts it, exactly as in CSS, so the caster has to stay small enough that the
    hole it punches in the middle of the disc is invisible — but not zero, which
    some backends skip as having nothing to draw.
  */
  bleed: {
    position: 'absolute',
    top: BLEED_INSET,
    right: BLEED_INSET,
    width: 1,
    height: 1,
  },
});
