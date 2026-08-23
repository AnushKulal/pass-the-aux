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
import { DarkPalette, Radii, Rule, Space, Type, type Palette } from '@/lib/theme';

/**
 * The pill that carries a state word or a numeral.
 *
 * "7 LIVE", "3 LISTENING", "PREMIUM", "NOT LINKED", "ON AUX", a DM unread
 * count, the provider label sitting on artwork — every one of those was its own
 * hand-rolled View + Text pair. They are the same object underneath: a short,
 * uppercase, non-interactive readout of state. One component means the rule
 * about WHICH of them may spend the accent lives in one place instead of
 * fifteen, which is the whole point — `tone` is a required prop for that
 * reason, so nobody reaches for the accent by leaving a default alone.
 *
 * NOT a control, ever. It takes no press: `Chip` in the theme is the tappable
 * filter pill, and a badge that looks pressable but is not is worse than one
 * that plainly is not. That is also why the 44px touch-target floor does not
 * apply to it and these are allowed to sit at 24px tall.
 */
export type StatusPillTone =
  /** `live` fill. RESERVED: live, playing, in sync, on aux, unread, selected. */
  | 'accent'
  /** Hairline on nothing. The register for everything the accent may not claim. */
  | 'outline'
  /** The inverted card's badge — reads as a label printed ON the cream. */
  | 'cream'
  /** A fixed dark ground for sitting on a photo. See `skinFor`. */
  | 'overlay';

export type StatusPillSize = 'sm' | 'md';

export type StatusPillProps = {
  label: string;
  tone: StatusPillTone;
  /** The leading circle. Add it when the pill reports a live or present count. */
  dot?: boolean;
  /** Pulses the dot. No effect without `dot` — the label alone never blinks. */
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
      return { bg: C.live, fg: C.onLive, border: CLEAR, dot: C.onLive };
    case 'cream':
      // The accent is legible ON cream at full strength; `liveText` is tuned to
      // sit on the ground and washes out against an off-white card.
      return { bg: C.cream, fg: C.onCream, border: CLEAR, dot: live ? C.live : C.onCream2 };
    case 'overlay':
      /*
        Deliberately pinned to the DARK palette rather than `useColors()`.
        This tone exists to stay readable on a photograph, and a photograph does
        not get lighter because the user switched to light mode — a pill that
        followed the theme here would turn into white text on a bright album
        cover. `dock` is the token for exactly this job: floating chrome sitting
        over content.
      */
      return {
        bg: DarkPalette.dock,
        fg: DarkPalette.ink,
        border: DarkPalette.rule,
        dot: live ? DarkPalette.liveText : DarkPalette.ink2,
      };
    case 'outline':
    default:
      return { bg: CLEAR, fg: C.ink2, border: C.rule2, dot: live ? C.liveText : C.ink3 };
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
    `Type.label` applies its letter-spacing after the LAST glyph too, which
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
      ]}>
      {dot ? <Dot size={s.dot} color={skin.dot} live={live} /> : null}
      {Icon ? <Icon size={s.icon} strokeWidth={2.4} color={skin.fg} /> : null}

      <Text
        numberOfLines={1}
        style={[numeral ? readout(s.font) : Type.label(s.font), { color: skin.fg }]}>
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
