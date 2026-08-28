/**
 * The pill that carries a state word or a numeral.
 *
 * Built from `design/nocturne/aux-nocturne.dc.html` L811–L813 (the quiet
 * `surface2` badges and the coral PREMIUM beside them), L1183-ish (the unread
 * count with its halo) and the twenty `--aux-live-w` wash pills scattered
 * through the intro and session screens.
 *
 * "7 LIVE", "3 LISTENING", "PREMIUM", "NOT LINKED", "ON AUX", a DM unread
 * count, the provider label sitting on artwork — every one of those was its own
 * hand-rolled View + Text pair. They are the same object underneath: a short,
 * uppercase, non-interactive readout of state.
 *
 * WHY `tone` IS REQUIRED, RESTATED FOR THE TWO-ACCENT WORLD.
 *
 * It used to be required so that nobody spent the one accent by leaving a
 * default alone. That still holds, but the thing being guarded has changed
 * shape. Nocturne runs two accents: CORAL is a state of the world (live,
 * playing, in sync, on aux, unread, premium) and BLUE is an action you take.
 * A StatusPill is never an action — it takes no press, it cannot be tapped —
 * so coral is its native register and blue is very nearly never right here.
 * `cream` survives for the one case that is: a label printed ON a primary
 * surface, where the pill belongs to the button rather than describing the
 * world. If you find yourself reaching for it anywhere else, the thing you
 * want is a `Chip` or an `AuxButton`. And `cream` takes NO coral, not even for
 * its dot — a badge sitting on the action surface that also carries the state
 * accent is one element in both, which is the violation this whole note exists
 * to prevent. See `skinFor`, where it was live until this pass.
 *
 * NOT a control, ever. `Chip` is the tappable filter pill, and a badge that
 * looks pressable but is not is worse than one that plainly is not. That is
 * also why the 44px touch-target floor does not apply to it and these are
 * allowed to sit at 24px tall.
 */

import type { LucideIcon } from 'lucide-react-native';
import { memo, useEffect } from 'react';
import { StyleSheet, Text, View, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useColors } from '@/lib/theme-context';
import { DarkPalette, Radii, Rule, Space, Type, tracking, type Palette } from '@/lib/theme';

export type StatusPillTone =
  /** Solid `live` fill. RESERVED: live, playing, in sync, on aux, unread, premium. */
  | 'accent'
  /**
   * The coral WASH — a 15% fill behind a `liveMid` edge, coral text. The
   * design's most common badge by a wide margin (20 uses): it says the same
   * thing `accent` does at a volume that can sit inside a card without
   * shouting over the card's own title.
   */
  | 'liveWash'
  /** `surface2` behind a hairline. The register for everything the accent may not claim. */
  | 'outline'
  /** A label printed ON a primary surface. See the note in the header. */
  | 'cream'
  /** A fixed dark ground for sitting on a photo. See `skinFor`. */
  | 'overlay';

export type StatusPillSize = 'sm' | 'md';

export type StatusPillProps = {
  label: string;
  tone: StatusPillTone;
  /** The leading circle. Add it when the pill reports a live or present count. */
  dot?: boolean;
  /**
   * Pulses the dot, and on the `accent` tone lights a coral halo behind the
   * whole pill. No effect without `dot` on the other tones — the label alone
   * never blinks.
   */
  live?: boolean;
  /** 12px at `sm`, 14px at `md`. Anything bigger belongs in a row, not a pill. */
  icon?: LucideIcon;
  /**
   * Defaults rather than being required: `sm` is the pill in a line of
   * metadata, which is nearly all of them. `md` is the one standing alone over
   * artwork, where 10px type loses to the photo behind it.
   */
  size?: StatusPillSize;
  /**
   * For pills whose label is not a sentence on its own — a bare "3" is read
   * out as "3" and means nothing without "unread".
   */
  accessibilityLabel?: string;
};

/**
 * Unlike its sibling in `aux-button.tsx`, nothing here interpolates between two
 * colours, so the plain keyword is safe — there is no Reanimated worklet that
 * needs a parseable value at both ends.
 */
const CLEAR = 'transparent';

type Skin = { bg: string; fg: string; border: string; dot: string };

function skinFor(tone: StatusPillTone, live: boolean, C: Palette): Skin {
  switch (tone) {
    case 'accent':
      // `onLive` is a warm near-black, not white — white on coral fails. Code
      // that assumes a filled accent means light text on it is wrong here.
      return { bg: C.live, fg: C.onLive, border: CLEAR, dot: C.onLive };
    case 'liveWash':
      return { bg: C.liveWash, fg: C.liveText, border: C.liveMid, dot: C.live };
    case 'cream':
      /*
        `cream` and `pill` resolve to the same blue in this direction, so this
        is the primary surface as a badge — and EVERYTHING on it comes out of
        that surface's own ink ramp.

        THE DOT USED TO READ `live ? C.live : C.onCream2`, which put the state
        accent (coral) on the action accent (blue) inside one 24px object: the
        exact thing the header above forbids. Nothing passes `tone="cream"`
        today, so it never reached a screen — it was a loaded gun in the kit
        rather than a visible bug, and the next person to reach for the tone
        would have fired it. `live` now lifts the dot from the muted white to
        the full one, which is emphasis inside the blue rather than a second
        hue, and `Dot` still breathes it: motion is not an accent, so a pulsing
        white dot on a blue badge claims nothing about the colour it is in.
      */
      return { bg: C.cream, fg: C.onCream, border: CLEAR, dot: live ? C.onCream : C.onCream2 };
    case 'overlay':
      /*
        Deliberately pinned to the DARK palette rather than `useColors()`.
        This tone exists to stay readable on a photograph, and a photograph does
        not get lighter because the user switched to light mode — a pill that
        followed the theme here would turn into white text on a bright album
        cover. `dock` is the token for exactly this job: floating chrome sitting
        over content, near-opaque because there is no blur underneath it. Do not
        swap it for `nav`, which is the translucent fill that lives BEHIND a
        blur and would let the artwork read straight through this pill.
      */
      return {
        bg: DarkPalette.dock,
        fg: DarkPalette.ink,
        border: DarkPalette.rule,
        dot: live ? DarkPalette.liveText : DarkPalette.ink2,
      };
    case 'outline':
    default:
      /*
        No longer a hairline on nothing, despite the name.

        Every quiet badge in the design is `surface2` behind a `rule` edge
        (L811, L812). The reason is the ground: `surface` cards are 5.5% white
        and translucent, so a transparent badge sitting on one has no fill of
        its own AND barely any edge, and simply disappears. The 9% fill is what
        makes it an object. The key survives because it is API; the recipe under
        it changed.
      */
      return { bg: C.surface2, fg: C.ink2, border: C.rule, dot: live ? C.liveText : C.ink3 };
  }
}

type Metrics = {
  minHeight: number;
  paddingHorizontal: number;
  gap: number;
  font: number;
  icon: number;
  dot: number;
};

const SIZES: Record<StatusPillSize, Metrics> = {
  // The gap is tighter than the padding on purpose: at 24px tall, a dot set
  // 8px off its own label reads as two objects rather than as one badge.
  sm: { minHeight: 24, paddingHorizontal: Space.sm, gap: Space.xs, font: 10, icon: 12, dot: 6 },
  md: { minHeight: 28, paddingHorizontal: Space.md, gap: Space.sm, font: 11, icon: 14, dot: 8 },
};

/** A count, with room for the "9+" form. Anything else is a word. */
const NUMERAL = /^\d+\+?$/;

/** `Type.readout()` hands back a readonly tuple; `TextStyle` wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

/**
 * The badge voice, and neither type role gives it whole.
 *
 * Every badge in the design is 800 at .08–.11em, uppercase. `Type.label` has
 * the case and the tracking but ships at 600, which goes soft at 9–10px against
 * the 800 kickers it sits beside; `Type.heading` has the weight but tracks at
 * .045em and does not uppercase. So this is `heading` with the label's case and
 * a tracking split between the design's two values. If `Type.label` ever moves
 * to extrabold — it was proposed and not taken — this collapses back to it.
 */
const badge = (size: number): TextStyle => ({
  ...Type.heading(size),
  letterSpacing: tracking(size, 0.09),
  textTransform: 'uppercase',
});

/**
 * The coral halo behind a live accent pill (design: the unread count at
 * `0 0 14px`). `bloom()` cannot express it — every recipe in the theme offsets
 * its shadow downward, and a halo has to be centred or it reads as the pill
 * casting onto whatever is under it rather than glowing.
 */
function halo(color: string) {
  return { boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 14, spreadDistance: 0, color }] };
}

export const StatusPill = memo(function StatusPill({
  label,
  tone,
  dot = false,
  live = false,
  icon: Icon,
  size = 'sm',
  accessibilityLabel,
}: StatusPillProps) {
  const C = useColors();
  const skin = skinFor(tone, live, C);
  const s = SIZES[size];

  /*
    A count gets the readout voice the type scale reserves for numbers: tabular
    figures, no tracking. Dropping the tracking is the load-bearing half —
    the badge voice applies its letter-spacing after the LAST glyph too, which
    shunts a lone digit visibly left of the centre of the circle it is meant to
    be centred in.
  */
  const numeral = NUMERAL.test(label);

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        styles.root,
        {
          minHeight: s.minHeight,
          // Rounds the short ones off: a single-digit unread count lands on
          // minWidth === minHeight at a full radius, which is a circle — no
          // second component, no prop to remember.
          minWidth: s.minHeight,
          paddingHorizontal: s.paddingHorizontal,
          gap: s.gap,
          backgroundColor: skin.bg,
          borderColor: skin.border,
        },
        // Only the solid fill can carry it. A halo behind the 15% wash would
        // be brighter than the pill it is supposed to be coming off.
        tone === 'accent' && live && halo(C.glowSoft),
      ]}>
      {dot ? <Dot size={s.dot} color={skin.dot} live={live} /> : null}
      {Icon ? <Icon size={s.icon} strokeWidth={2.4} color={skin.fg} /> : null}

      <Text
        numberOfLines={1}
        style={[numeral ? readout(s.font) : badge(s.font), { color: skin.fg }]}>
        {label}
      </Text>
    </View>
  );
});

/**
 * The live mark, at pill scale.
 *
 * Deliberately not `LivePulse`: that one expands a halo to 2.6 times its own
 * size, which reads as a bloom on an open card but inside a 24px pill is a
 * smudge across the fill and eats the label's gap. This breathes on opacity
 * alone — no halo, no scale, nothing that can shift the row it sits in.
 */
function Dot({ size, color, live }: { size: number; color: string; live: boolean }) {
  const reduced = useReducedMotion();
  const wave = useSharedValue(1);

  useEffect(() => {
    if (!live || reduced) {
      cancelAnimation(wave);
      wave.value = 1;
      return;
    }
    // 700 out and 700 back is the same 1400ms period `LivePulse` runs at, so a
    // screen showing both marks has them breathing in step rather than beating
    // against each other.
    wave.value = withRepeat(
      withTiming(0.3, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => cancelAnimation(wave);
  }, [live, reduced, wave]);

  const pulse = useAnimatedStyle(() => ({ opacity: wave.value }));

  return (
    <Animated.View
      style={[
        { width: size, height: size, borderRadius: Radii.pill, backgroundColor: color },
        pulse,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    // Centred so the numeral case sits dead centre of its circle; identical to
    // flex-start for any pill already wider than its content.
    justifyContent: 'center',
    borderRadius: Radii.pill,
    // Held at 1 on every tone — the same invariant `AuxButton` keeps. Swapping
    // a tone must never move the pill or reflow the row it sits in, so the
    // filled tones carry a transparent border rather than no border.
    borderWidth: Rule.hair,
    // Without this, a pill inside a column stretches to the column's width.
    alignSelf: 'flex-start',
  },
});
