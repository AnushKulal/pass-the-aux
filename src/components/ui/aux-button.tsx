import * as Haptics from 'expo-haptics';
import type { LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { useColors } from '@/lib/theme-context';
import { Duration, Fonts, Radius, Rule, Space, tracking, Type, type Palette } from '@/lib/theme';

/**
 * Patchbay has four button shapes, all with square corners and a left-aligned
 * label:
 *
 * - `live`        — accent fill, `onLive` label. The reserved colour: Join,
 *                   Play, Go live, Take the aux, Start a Session.
 * - `liveOutline` — 1px accent border, `liveText` label. The accent's quieter
 *                   register (START A SESSION, FIND A LOUNGE, BACK TO THE FEED).
 * - `bordered`    — 1px `rule3` on nothing, ink label. Every non-accent action.
 * - `ghost`       — no border at all, ink2 label.
 * - `danger`      — destructive fill.
 *
 * The old names are still accepted so no call site had to change: `accent` is
 * `live` and `primary` is `bordered` — there is no filled non-accent button in
 * this direction, because a second fill would compete with the one colour that
 * means live.
 */
export type AuxButtonVariant =
  | 'live'
  | 'liveOutline'
  | 'bordered'
  | 'ghost'
  | 'danger'
  /** @deprecated alias for `live`. */
  | 'accent'
  /** @deprecated alias for `bordered`. */
  | 'primary';

type ResolvedVariant = 'live' | 'liveOutline' | 'bordered' | 'ghost' | 'danger';

const ALIASES: Record<AuxButtonVariant, ResolvedVariant> = {
  live: 'live',
  liveOutline: 'liveOutline',
  bordered: 'bordered',
  ghost: 'ghost',
  danger: 'danger',
  accent: 'live',
  primary: 'bordered',
};

export type AuxButtonSize = 'sm' | 'md' | 'lg';

export type AuxButtonProps = {
  label: string;
  onPress: () => void;
  variant?: AuxButtonVariant;
  size?: AuxButtonSize;
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
};

/**
 * Reanimated's colour interpolation needs a real colour at both ends; the
 * string 'transparent' is not one everywhere, so unfilled variants start from an
 * explicit zero-alpha black.
 */
const CLEAR = 'rgba(0,0,0,0)';

type Skin = {
  bg: string;
  bgPress: string;
  fg: string;
  border: string;
  borderPress: string;
  /** Accent labels are uppercase and widely tracked; prose labels are not. */
  shout: boolean;
};

function skinFor(v: ResolvedVariant, C: Palette): Skin {
  switch (v) {
    case 'live':
      // Pressed goes *brighter*, not darker — `liveText` is the same hue lifted.
      return {
        bg: C.live,
        bgPress: C.liveText,
        fg: C.onLive,
        border: CLEAR,
        borderPress: CLEAR,
        shout: true,
      };
    case 'liveOutline':
      return {
        bg: CLEAR,
        bgPress: C.liveWash,
        fg: C.liveText,
        border: C.live,
        borderPress: C.live,
        shout: true,
      };
    case 'danger':
      return {
        bg: CLEAR,
        bgPress: C.dangerWash,
        fg: C.danger,
        border: C.dangerBorder,
        borderPress: C.danger,
        shout: true,
      };
    case 'ghost':
      return {
        bg: CLEAR,
        bgPress: C.surface,
        fg: C.ink2,
        border: CLEAR,
        borderPress: CLEAR,
        shout: false,
      };
    case 'bordered':
    default:
      return {
        bg: CLEAR,
        bgPress: C.surface2,
        fg: C.ink,
        border: C.rule3,
        borderPress: C.ink,
        shout: false,
      };
  }
}

/**
 * Two heights only — 46 for a control that sits inside a row or a header, 52 for
 * a screen's primary action. `lg` is kept as an alias of `md` so the old
 * three-size call sites still compile.
 */
const SIZES: Record<
  AuxButtonSize,
  { minHeight: number; paddingHorizontal: number; gap: number; icon: number; font: number }
> = {
  sm: { minHeight: 46, paddingHorizontal: Space.lg, gap: Space.sm, icon: 15, font: 11 },
  md: { minHeight: 52, paddingHorizontal: Space.lg, gap: Space.sm, icon: 18, font: 13 },
  lg: { minHeight: 52, paddingHorizontal: Space.xl, gap: Space.md, icon: 20, font: 13 },
};

export function AuxButton({
  label,
  onPress,
  variant = 'bordered',
  size = 'md',
  icon: Icon,
  loading = false,
  disabled = false,
  fullWidth = false,
}: AuxButtonProps) {
  const C = useColors();
  const skin = skinFor(ALIASES[variant] ?? 'bordered', C);
  const s = SIZES[size];
  const blocked = disabled || loading;

  /*
    Colour eases rather than the box scaling: scaling a button nudges the rows
    around it on Android and makes long labels reflow mid-press.

    The held flag is React state driving the shared value from an effect rather
    than a write straight out of the press handler — the compiler treats a shared
    value as immutable outside an effect, and one extra render per press is not
    a cost worth arguing with it over.
  */
  const [pressed, setPressed] = useState(false);
  const reduced = useReducedMotion();
  const press = useSharedValue(0);

  useEffect(() => {
    press.value = withTiming(pressed ? 1 : 0, { duration: reduced ? 0 : Duration.press });
  }, [pressed, reduced, press]);

  const animated = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(press.value, [0, 1], [skin.bg, skin.bgPress]),
    borderColor: interpolateColor(press.value, [0, 1], [skin.border, skin.borderPress]),
  }));

  const onPressIn = useCallback(() => setPressed(true), [setPressed]);
  const onPressOut = useCallback(() => setPressed(false), [setPressed]);

  const handlePress = useCallback(() => {
    // expo-haptics is a no-op stub on web, but calling it there still costs a
    // promise per tap for nothing.
    if (Platform.OS !== 'web') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress();
  }, [onPress]);

  const labelStyle = skin.shout
    ? {
        ...Type.heading(s.font),
        // The accent labels in the prototype run wider than the heading default.
        letterSpacing: tracking(s.font, 0.1),
        textTransform: 'uppercase' as const,
      }
    : {
        fontFamily: Fonts.semibold,
        fontSize: s.font,
        lineHeight: Math.round(s.font * 1.25),
        letterSpacing: tracking(s.font, 0.06),
      };

  return (
    <Animated.View
      style={[
        styles.base,
        animated,
        { minHeight: s.minHeight },
        fullWidth && styles.fullWidth,
        blocked && styles.blocked,
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: blocked, busy: loading }}
        disabled={blocked}
        onPress={handlePress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        style={[
          styles.hit,
          { minHeight: s.minHeight, paddingHorizontal: s.paddingHorizontal, gap: s.gap },
        ]}>
        {loading ? (
          <ActivityIndicator size="small" color={skin.fg} />
        ) : Icon ? (
          <Icon size={s.icon} strokeWidth={2} color={skin.fg} />
        ) : null}

        <Text numberOfLines={1} style={[labelStyle, { color: skin.fg }]}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius,
    // Held at 1 on every variant so swapping variants never changes layout.
    borderWidth: Rule.hair,
    alignSelf: 'flex-start',
  },
  hit: {
    flexDirection: 'row',
    alignItems: 'center',
    // Labels are flush left, the way every button in the prototype sets them —
    // the gutter, not the centre line, is what this design aligns to.
    justifyContent: 'flex-start',
  },
  fullWidth: {
    alignSelf: 'stretch',
    width: '100%',
  },
  /** The disabled cell in the prototype is the live cell at 55%. */
  blocked: {
    opacity: 0.55,
  },
});
