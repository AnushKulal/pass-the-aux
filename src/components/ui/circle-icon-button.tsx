/**
 * The circular icon button.
 *
 * One control, seven skins. It is the most-used piece of chrome in Apex: the
 * back chip in a header, the search toggle beside it, the play button sitting
 * on a piece of artwork, the 72px centre of a transport row. All of those were
 * hand-rolled square Pressables in Patchbay, each with its own padding and its
 * own idea of what "pressed" looks like.
 *
 * Two things are load-bearing here.
 *
 * The SIZE is the diameter, never the touch target. 36 and 40 are legitimate
 * sizes in this design — a back chip beside a title cannot be 44px tall without
 * out-shouting the title — so those sizes keep their small circle and grow the
 * target outward with hitSlop instead. Shrinking the target to match the circle
 * is the one thing this component must never do.
 *
 * The TONE decides fill and glyph together, as a pair. They are never separate
 * props, because every legible combination is already in the table below, and a
 * caller picking its own two colours is how an accent ends up on a decoration.
 */

import type { LucideIcon } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {
  DarkPalette,
  Duration,
  Radii,
  Space,
  TOUCH_TARGET,
  Type,
  glowShadow,
  type Palette,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** Diameter of the circle. Not the touch target — see the note on `slop`. */
export type CircleIconButtonSize = 36 | 40 | 44 | 48 | 52 | 72;

export type CircleIconButtonTone =
  /** Raised chrome on the ground — the default. */
  | 'surface'
  /** The quieter fill, for a control sitting inside an already-raised card. */
  | 'chip'
  /** On artwork. */
  | 'overlay'
  /** RESERVED. Play, join, go live. */
  | 'live'
  /** The inverted card's control. One per screen, same as the card. */
  | 'cream'
  /** No fill at all, for a row where seven filled circles would be noise. */
  | 'ghost'
  /** Destructive. */
  | 'danger';

export type CircleIconButtonProps = {
  icon: LucideIcon;
  onPress: () => void;
  /**
   * REQUIRED, and not a formality: the button is icon-only, so this string is
   * the entire name the control has. "Go back", not "arrow".
   */
  accessibilityLabel: string;
  size?: CircleIconButtonSize;
  tone?: CircleIconButtonTone;
  disabled?: boolean;
  /** A small count in the top-right corner. `0` and `undefined` both hide it. */
  badge?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Glyph size per diameter, as a table rather than a ratio.
 *
 * A ratio lands on odd numbers (52 * 0.45 = 23.4) and a lucide stroke on a
 * half-pixel grid renders soft. 52 matches the nav dock exactly, because a dock
 * cell and a header button of the same diameter that disagree about glyph size
 * read as a mistake rather than a decision.
 */
const GLYPH: Record<CircleIconButtonSize, number> = {
  36: 16,
  40: 18,
  44: 20,
  48: 22,
  52: 22,
  72: 30,
};

/** How far the circle shrinks under a finger: 1 − this = 0.9. */
const PRESS_SCALE = 0.1;

/**
 * The reduced-motion substitute.
 *
 * Someone who has turned motion off still needs to know the tap registered, and
 * on an icon-only control there is no label to change. A short opacity fade is
 * not motion, so it is the one feedback that survives the setting.
 */
const PRESS_FADE = 0.3;

/** Matches the two badges already in the app: 15 on tight chrome, 18 elsewhere. */
const badgeBox = (size: CircleIconButtonSize) => (size >= 48 ? 18 : 15);

type Skin = { bg: string; fg: string; glow: boolean };

function skinFor(tone: CircleIconButtonTone, C: Palette): Skin {
  switch (tone) {
    case 'chip':
      return { bg: C.chip, fg: C.ink2, glow: false };
    case 'overlay':
      /*
        Deliberately NOT from `useColors()`. This tone exists to sit ON a
        photograph, so what is behind it is album art, not the theme — and a
        fill that went pale in light mode would strand a white glyph on a
        bright image. `DarkPalette` is the theme-invariant read of the same
        tokens, so this is still a token, only a pinned one.

        `dock`, not `scrim`: the token comment calls `dock` "floating chrome,
        over content", which is this exact job, while `scrim` is the 88% sheet
        dimmer. `StatusPill`'s overlay tone reads the same token — the two are
        routinely on the same piece of artwork, and a play button 6% darker
        than the pill beside it reads as one of them being wrong.
      */
      return { bg: DarkPalette.dock, fg: DarkPalette.ink, glow: false };
    case 'live':
      return { bg: C.live, fg: C.onLive, glow: true };
    case 'cream':
      return { bg: C.cream, fg: C.onCream, glow: false };
    case 'ghost':
      return { bg: 'transparent', fg: C.ink2, glow: false };
    case 'danger':
      return { bg: C.dangerWash, fg: C.danger, glow: false };
    case 'surface':
    default:
      return { bg: C.surface, fg: C.ink, glow: false };
  }
}

export function CircleIconButton({
  icon: Icon,
  onPress,
  accessibilityLabel,
  size = 44,
  tone = 'surface',
  disabled = false,
  badge,
  style,
}: CircleIconButtonProps) {
  const C = useColors();
  const reduced = useReducedMotion();
  const skin = skinFor(tone, C);

  /*
    The held flag is React state driving the shared values from an effect,
    rather than a write straight out of the press handler: the compiler treats a
    shared value as immutable outside an effect. Same trade as `AuxButton`,
    `Chip` and `PhotoCard` — one extra render per press, and the whole kit
    presses the same way.

    (The direct write this replaced lints clean only by accident: the old
    worklet closed over `reduced`, which made the compiler bail on the whole
    component and take `react-hooks/immutability` down with it. The old dock did
    the same write with a worklet that captures nothing, and still errors.)
  */
  const [held, setHeld] = useState(false);

  /*
    Two channels rather than one shared value read two ways, so that WHICH
    channel carries the feedback stays a render-time decision. A worklet that
    closed over `reduced` would be the compiler bail-out described above. The
    timing is one `Duration.press` either way, which was the point of sharing a
    value in the first place.
  */
  const scale = useSharedValue(1);
  const fade = useSharedValue(1);

  useEffect(() => {
    scale.value = withTiming(held && !reduced ? 1 - PRESS_SCALE : 1, {
      duration: Duration.press,
    });
    fade.value = withTiming(held && reduced ? 1 - PRESS_FADE : 1, {
      duration: Duration.press,
    });
  }, [held, reduced, scale, fade]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: fade.value,
  }));

  /*
    36 and 40 sit under the 44px minimum, so the TARGET grows outward while the
    circle stays put: hitSlop costs no layout, where padding would shove the
    title beside it. Callers still owe 8px between two of these — at 36 the slop
    already reaches 4px past the edge, and two touching buttons would trade taps.
  */
  const slop = Math.max(0, (TOUCH_TARGET - size) / 2);

  const box = badgeBox(size);
  const showBadge = badge !== undefined && badge > 0;

  /*
    The badge INVERTS on the live tone. Everywhere else it is the accent doing
    one of its reserved jobs, but accent-on-accent is an invisible badge, so on
    a live fill the two colours simply swap.
  */
  const badgeBg = tone === 'live' ? C.onLive : C.live;
  const badgeFg = tone === 'live' ? C.live : C.onLive;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      /* The count is a value ON this control, not a second control — announcing
         it here keeps the badge out of the focus order. */
      accessibilityValue={showBadge ? { text: String(badge) } : undefined}
      disabled={disabled}
      hitSlop={slop}
      onPress={onPress}
      onPressIn={() => setHeld(true)}
      onPressOut={() => setHeld(false)}
      style={[disabled && styles.blocked, style]}>
      <Animated.View
        style={[
          styles.circle,
          animated,
          { width: size, height: size, backgroundColor: skin.bg },
          /* The bloom scales with the button: a 24px radius that reads as
             ambient light at 44 reads as a smudge at 72. */
          skin.glow ? glowShadow(C.glow, Math.round(size / 2)) : null,
        ]}>
        <Icon size={GLYPH[size]} strokeWidth={2} color={skin.fg} />
      </Animated.View>

      {/*
        Pinned to the corner of the LAYOUT box, which for an inscribed circle is
        already outside the fill — so it needs no negative offset and nothing
        can clip it on Android. It is a sibling of the animated circle rather
        than a child: a count that shrinks under the finger is unreadable at the
        exact moment you are most likely to be looking at it.
      */}
      {showBadge ? (
        <View style={[styles.badge, { minWidth: box, height: box, backgroundColor: badgeBg }]}>
          <Text numberOfLines={1} style={[styles.badgeText, { lineHeight: box, color: badgeFg }]}>
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    paddingHorizontal: Space.xs,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    ...Type.readout(10),
    /*
      `Type.readout()` freezes its `fontVariant` as a readonly tuple, which RN's
      mutable `FontVariant[]` will not take. Re-stating it is the whole fix, and
      keeps the tabular figures — a badge that changes width between 1 and 7 is
      exactly what the readout role exists to prevent.
    */
    fontVariant: ['tabular-nums'] as NonNullable<TextStyle['fontVariant']>,
  },
  /** The disabled cell, at the same 55% AuxButton uses. */
  blocked: {
    opacity: 0.55,
  },
});
