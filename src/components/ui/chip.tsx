/**
 * The pill filter chip, and the row it lives in.
 *
 * Built from `design/nocturne/aux-nocturne.dc.html` L139 (the Sign in / Create
 * account pair) and L435–L438 (the lounge's Sessions / Chat / Members row) —
 * the same control at two widths.
 *
 * One control replacing five hand-built segmented rows, so it has to cover both
 * shapes the references use:
 *
 *  - `scroll` — a full-bleed strip with more options than fit, so it runs off
 *    the edge and invites a drag. The chips sit directly on the ground, each
 *    carrying its own `surface2` fill behind a `rule` hairline.
 *  - `hug` — a width-hugging capsule for two or three mutually exclusive
 *    options (Dark / Light / System, public / private). Here the TRACK supplies
 *    the surface and the unselected chips go transparent; a chip fill inside a
 *    track fill is two translucent whites stacked, which composites to a
 *    brighter grey than either and reads as a rendering mistake.
 *
 * THE SELECTED CHIP IS BLUE, AND THAT IS A CHANGE.
 *
 * This file used to argue that the accent belonged here and only here, because
 * "a selected filter is what you are currently looking at, which is the same
 * claim the red makes everywhere else in the app". The reasoning was sound and
 * the conclusion is now wrong. Nocturne splits the load one red used to carry:
 * CORAL means a state of the world — live, playing, in sync, unread — and BLUE
 * means an action you took. A selected chip is the second one. Nobody's filter
 * choice is happening in the world; it happened in this app, because they
 * tapped it. Painting it coral would put it in the same register as a LIVE
 * badge sitting two rows below, and the badge is the one that has to win.
 *
 * ONE selection, always. `selectedKey` is not nullable because every reference
 * row opens with `All` already lit — "no filter" is a chip, not an empty state.
 */

import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { memo, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type AccessibilityRole,
  type AccessibilityState,
  type TextStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

// The metrics token is also called `Chip`, and so is the component below it.
// Aliasing here rather than renaming the component keeps the call site reading
// `<Chip />`, which is the name that matters to everyone else.
import {
  Chip as ChipMetrics,
  Duration,
  Radii,
  Rule,
  Space,
  TOUCH_TARGET,
  Type,
  bloom,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** Leading glyph. 16 against an 11px label — any larger and the icon leads. */
const ICON = 16;

/**
 * The chip and the platform's touch target agree at 44 in this design, so the
 * slop is zero and the constant survives only to keep the arithmetic visible:
 * shrink `ChipMetrics.height` and the hit box grows back automatically.
 *
 * VERTICAL ONLY. `ChipMetrics.gap` is exactly the 8px minimum between adjacent
 * targets, so widening the hit box sideways would spend a gap that is already
 * fully committed.
 */
const SLOP = Math.max(0, (TOUCH_TARGET - ChipMetrics.height) / 2);
const HIT_SLOP = { top: SLOP, bottom: SLOP } as const;

/** `Type.readout` hands back a readonly fontVariant tuple; TextStyle wants a mutable one. */
const readout = (size: number): TextStyle => ({
  ...Type.readout(size),
  fontVariant: ['tabular-nums'],
});

/**
 * What the chip is, semantically — and it is never just a button.
 *
 * `tab` switches which content is shown, `radio` picks one setting out of a
 * set, `filter` narrows a list that is already on screen. Each maps to a
 * different item role AND a different container role; a correct item inside the
 * wrong container is announced as a loose control belonging to no group, which
 * is how hand-built rows usually get it wrong.
 *
 * React Native has no `filter` role. A filter chip is a button that stays
 * pressed, which is precisely `togglebutton`, and `toolbar` is the closest
 * container the platform offers for a strip of them.
 */
export type ChipRole = 'tab' | 'radio' | 'filter';

const ROLES: Record<ChipRole, { item: AccessibilityRole; group: AccessibilityRole }> = {
  tab: { item: 'tab', group: 'tablist' },
  radio: { item: 'radio', group: 'radiogroup' },
  filter: { item: 'togglebutton', group: 'toolbar' },
};

/**
 * `tab` reports `selected`; `radio` and `togglebutton` report `checked`. They
 * are not interchangeable — setting the one the role does not read leaves the
 * chip announcing its label and nothing at all about its state.
 */
function a11yState(role: ChipRole, selected: boolean, disabled: boolean): AccessibilityState {
  return role === 'tab' ? { selected, disabled } : { checked: selected, disabled };
}

export type ChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  /** Leading glyph, drawn in the label's colour. */
  icon?: LucideIcon;
  /** Trailing tally — `4` on a filter that would match four rows. */
  count?: number;
  disabled?: boolean;
  role?: ChipRole;
  /**
   * The chip is a cell inside a `hug` track, which already paints a surface
   * beneath it, so the unselected fill drops to transparent. Set by `ChipRow`;
   * a standalone chip has no track and should leave this alone.
   */
  onTrack?: boolean;
};

/**
 * Held at 1 on every state. A selected chip is a blue fill and an unselected
 * one is a hairline, and if the hairline were the only one with a border the
 * whole row would shift by 2px on every tap.
 */
const CLEAR = 'transparent';

export const Chip = memo(function Chip({
  label,
  selected,
  onPress,
  icon: Icon,
  count,
  disabled = false,
  role = 'filter',
  onTrack = false,
}: ChipProps) {
  const C = useColors();
  const fg = selected ? C.pillInk : C.ink2;

  /*
    The held flag is React state driving the shared value from an effect, rather
    than a write straight out of the press handler: the React Compiler treats a
    shared value as immutable outside an effect, and one extra render per press
    is not a cost worth arguing with it over. (the old dock did the direct
    write, and still trips the rule.)
  */
  const [held, setHeld] = useState(false);
  const reduced = useReducedMotion();
  const press = useSharedValue(1);

  useEffect(() => {
    press.value = withTiming(held && !reduced ? 0.94 : 1, {
      duration: reduced ? 0 : Duration.press,
    });
  }, [held, reduced, press]);

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));

  /*
    Selection SNAPS; only the press scales.

    Fading the fill and the label would be easy, but the leading glyph is an SVG
    whose stroke colour cannot be driven from the UI thread — so a crossfade
    would show two thirds of the chip easing while the icon jumped. All three
    changing together is the coherent version.
  */
  return (
    <Pressable
      accessibilityRole={ROLES[role].item}
      accessibilityState={a11yState(role, selected, disabled)}
      // Spoken as one phrase, so the tally is not announced as a stray number
      // trailing the label.
      accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      onPress={() => {
        // A no-op on web, but calling it there still costs a promise per tap.
        if (Platform.OS !== 'web') {
          void Haptics.selectionAsync();
        }
        onPress();
      }}
      onPressIn={() => setHeld(true)}
      onPressOut={() => setHeld(false)}>
      <Animated.View
        style={[
          styles.pill,
          animated,
          {
            backgroundColor: selected ? C.pill : onTrack ? CLEAR : C.surface2,
            borderColor: selected || onTrack ? CLEAR : C.rule,
          },
          /*
            The blue bloom under the selected chip is not decoration — it is how
            this direction says how much weight a control carries, and the
            design scales it with height all the way from a 34px knob to a 66px
            play button. `bloom.sm` is 0/8/24 against the artboard's 0/6/18 for
            a segment this size; two pixels of blur is worth keeping every glow
            in the app on one ladder.
          */
          selected && bloom(C.glow, 'sm'),
          disabled && styles.disabled,
        ]}>
        {Icon ? <Icon size={ICON} strokeWidth={selected ? 2.4 : 2} color={fg} /> : null}

        <Text numberOfLines={1} style={[styles.label, { color: fg }]}>
          {label}
        </Text>

        {count === undefined ? null : (
          <Text style={[styles.count, { color: selected ? C.pillInk : C.ink3 }]}>{count}</Text>
        )}
      </Animated.View>
    </Pressable>
  );
});

export type ChipItem = {
  key: string;
  label: string;
  icon?: LucideIcon;
  count?: number;
  disabled?: boolean;
};

export type ChipRowVariant = 'scroll' | 'hug';

export type ChipRowProps = {
  items: ChipItem[];
  selectedKey: string;
  onSelect: (key: string) => void;
  variant?: ChipRowVariant;
  role?: ChipRole;
};

/**
 * `scroll` is FULL-BLEED. It pads its own content out to the screen gutter so
 * the first chip lines up with the headings above it and the last one runs
 * under the edge — which means it wants a parent that is *not* already
 * gutter-padded (`<Screen padded={false}>`, or a negative margin). Inside a
 * padded parent the strip stops 36px short on both sides and stops reading as
 * something you can drag.
 *
 * `hug` pairs with `role="radio"` almost every time: two or three options where
 * exactly one is true is a radio group, not a set of filters.
 */
export function ChipRow({
  items,
  selectedKey,
  onSelect,
  variant = 'scroll',
  role = 'filter',
}: ChipRowProps) {
  const C = useColors();
  const hug = variant === 'hug';

  const chips = items.map((item) => (
    <Chip
      key={item.key}
      label={item.label}
      icon={item.icon}
      count={item.count}
      disabled={item.disabled}
      role={role}
      onTrack={hug}
      selected={item.key === selectedKey}
      onPress={() => {
        // The chip still ticks on a re-tap — the tap did land, and silence
        // reads as a dropped touch — but the row swallows the redundant
        // callback so consumers do not re-render or re-fetch behind it.
        if (item.key !== selectedKey) onSelect(item.key);
      }}
    />
  ));

  if (hug) {
    return (
      <View
        accessibilityRole={ROLES[role].group}
        style={[styles.track, { backgroundColor: C.surface, borderColor: C.rule }]}>
        {chips}
      </View>
    );
  }

  return (
    <ScrollView
      accessibilityRole={ROLES[role].group}
      horizontal
      showsHorizontalScrollIndicator={false}
      // Without this a horizontal ScrollView inside a column stretches to eat
      // every pixel of leftover height, pushing whatever follows it off screen.
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}>
      {chips}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    // Centred, unlike every other label in this design. A pill is symmetrical,
    // and a flush-left label inside one just looks like a layout bug.
    alignItems: 'center',
    justifyContent: 'center',
    height: ChipMetrics.height,
    paddingHorizontal: ChipMetrics.paddingX,
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
    gap: Space.sm,
  },
  /*
    `Type.heading`, not `Type.label`.

    Every segment in the design is 800 at ~.04em and in SENTENCE case —
    "Sessions", "Create account", "Members". `Type.label` is 600, tracked to
    .12em, and force-uppercases, which turns a two-word label into a wide
    shouted band that no longer fits the pill. `heading` is the exact voice:
    same weight, same tracking, no transform.
  */
  label: {
    ...Type.heading(11),
    // Lets a long label truncate inside a narrow chip instead of forcing the
    // pill wider than the row it sits in.
    flexShrink: 1,
  },
  count: readout(11),
  /** The same 55% the rest of the kit disables at. */
  disabled: {
    opacity: 0.55,
  },

  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    alignItems: 'center',
    gap: ChipMetrics.gap,
    // The screen gutter, applied to the CONTENT rather than to the ScrollView:
    // padding on the scroller itself clips the chips at the edge instead of
    // letting them travel under it. 18 is a literal because `Space` has no step
    // for the gutter yet — same note as the one at the top of `screen.tsx`.
    paddingHorizontal: 18,
    // Room for the hit slop. Android drops touches landing outside the parent's
    // bounds, so any extra pixels each side have to exist as real layout.
    paddingVertical: SLOP,
  },

  track: {
    flexDirection: 'row',
    alignItems: 'center',
    // Hugs its content — this is a control, not a bar.
    alignSelf: 'flex-start',
    borderRadius: Radii.pill,
    borderWidth: Rule.hair,
    /*
      The design runs 5px of padding and 5px between cells, which lands between
      `Space.xs` and `Space.sm`; 4 is the nearer step. The gap is new — the
      cells used to sit flush, which was right when the selected cell was a flat
      fill. It is a blue pill with a bloom under it now, and a bloom needs a
      little air on both sides or it just tints its neighbours.
    */
    padding: Space.xs,
    gap: Space.xs,
  },
});
