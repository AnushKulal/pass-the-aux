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
import {
  Duration,
  Fonts,
  Radii,
  Radius,
  Rule,
  Space,
  tracking,
  Type,
  type Palette,
} from '@/lib/theme';

/**
 * Aux has five button tones. Every one of them defaults to the house corner
 * and a flush-left label; `shape="pill"` and `align="center"` are the two
 * overrides the photo-forward screens want, and `PillButton` at the bottom of
 * this file is that pair pre-applied.
 *
 * - `live`        — accent fill, `onLive` label. The reserved colour: Join,
 *                   Play, Go live, Take the aux, Start a Session.
 * - `liveOutline` — 1px accent border, `liveText` label. The accent's quieter
 *                   register (START A SESSION, FIND A LOUNGE, BACK TO THE FEED).
 * - `bordered`    — 1px `rule3` on nothing, ink label. Every non-accent action.
 * - `ghost`       — no border at all, ink2 label.
 * - `danger`      — destructive fill.
 * - `cream`       — the inverted card, as a button: `cream` fill, `onCream`
 *                   label. One per screen, like the cream card it belongs to —
 *                   it is the loudest thing on a screen that is not the accent,
 *                   so a second one cancels the first.
 *
 * The old names are still accepted so no call site had to change: `accent` is
 * `live` and `primary` is `bordered`. `cream` is the only non-accent fill, and
 * it earns that by being a different VALUE rather than a second hue — another
 * colour here would compete with the one that means live.
 */
export type AuxButtonVariant =
  | 'live'
  | 'liveOutline'
  | 'bordered'
  | 'ghost'
  | 'danger'
  | 'cream'
  /** @deprecated alias for `live`. */
  | 'accent'
  /** @deprecated alias for `bordered`. */
  | 'primary';

type ResolvedVariant = 'live' | 'liveOutline' | 'bordered' | 'ghost' | 'danger' | 'cream';

const ALIASES: Record<AuxButtonVariant, ResolvedVariant> = {
  live: 'live',
  liveOutline: 'liveOutline',
  bordered: 'bordered',
  ghost: 'ghost',
  danger: 'danger',
  cream: 'cream',
  accent: 'live',
  primary: 'bordered',
};

export type AuxButtonSize = 'sm' | 'md' | 'lg' | 'xl';
export type AuxButtonShape = 'square' | 'pill';
export type AuxButtonAlign = 'left' | 'center';

export type AuxButtonProps = {
  label: string;
  onPress: () => void;
  variant?: AuxButtonVariant;
  size?: AuxButtonSize;
  /** `pill` rounds the cell fully; the default keeps the house 24px corner. */
  shape?: AuxButtonShape;
  /** `center` centres the icon + label group; the default keeps them flush left. */
  align?: AuxButtonAlign;
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
    case 'cream':
      /*
        There is no second cream in the palette — `onCream2` is the only
        companion value and it is a text colour, so easing the fill towards it
        would flip the cell dark mid-press. Cream presses by drawing its own
        hairline IN instead: the border is already sitting there at 1px on every
        variant (see `styles.base`), so the ring costs no layout and reads as
        the cell being gripped rather than recoloured.
      */
      return {
        bg: C.cream,
        bgPress: C.cream,
        fg: C.onCream,
        border: CLEAR,
        borderPress: C.onCream2,
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
 * Three heights — 46 for a control that sits inside a row or a header, 52 for a
 * screen's primary action, 56 for the one hero button a screen is allowed. `lg`
 * is kept as an alias of `md` so the old three-size call sites still compile.
 *
 * `xl` is the only step that also opens the padding out: at 56 tall the `lg`
 * gutter leaves the label sitting too close to a pill's curve.
 */
const SIZES: Record<
  AuxButtonSize,
  { minHeight: number; paddingHorizontal: number; gap: number; icon: number; font: number }
> = {
  sm: { minHeight: 46, paddingHorizontal: Space.lg, gap: Space.sm, icon: 15, font: 11 },
  md: { minHeight: 52, paddingHorizontal: Space.lg, gap: Space.sm, icon: 18, font: 13 },
  lg: { minHeight: 52, paddingHorizontal: Space.xl, gap: Space.md, icon: 20, font: 13 },
  xl: { minHeight: 56, paddingHorizontal: Space.xxl, gap: Space.md, icon: 20, font: 14 },
};

export function AuxButton({
  label,
  onPress,
  variant = 'bordered',
  size = 'md',
  shape = 'square',
  align = 'left',
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
        shape === 'pill' && styles.pill,
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
          align === 'center' && styles.hitCenter,
          { minHeight: s.minHeight, paddingHorizontal: s.paddingHorizontal, gap: s.gap },
        ]}>
        {loading ? (
          <ActivityIndicator size="small" color={skin.fg} />
        ) : Icon ? (
          <Icon size={s.icon} strokeWidth={2} color={skin.fg} />
        ) : null}

        <Text numberOfLines={1} style={[styles.label, labelStyle, { color: skin.fg }]}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The full-width hero button: a centred label in a fully rounded 56px cell.
 *
 * The four layout props are omitted rather than defaulted, because a
 * `PillButton` that could be handed `shape="square"` is just `AuxButton` with
 * extra steps. `variant` stays open — the hero on one screen is `live`, on the
 * next it is `cream`.
 */
export type PillButtonProps = Omit<AuxButtonProps, 'shape' | 'align' | 'size' | 'fullWidth'>;

export function PillButton(props: PillButtonProps) {
  return <AuxButton {...props} shape="pill" align="center" size="xl" fullWidth />;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius,
    // Held at 1 on every variant so swapping variants never changes layout.
    borderWidth: Rule.hair,
    alignSelf: 'flex-start',
  },
  /**
   * Only ever paired with `base`, never instead of it, so the 1px border and
   * its layout guarantee survive the rounding.
   */
  pill: {
    borderRadius: Radii.pill,
  },
  hit: {
    flexDirection: 'row',
    alignItems: 'center',
    // Labels are flush left, the way every button in the prototype sets them —
    // the gutter, not the centre line, is what this design aligns to.
    justifyContent: 'flex-start',
  },
  hitCenter: {
    justifyContent: 'center',
  },
  /*
    Lets a long label truncate inside a constrained button instead of running
    past its right edge. Invisible on the default `alignSelf: 'flex-start'`
    button, which is already exactly as wide as its content.
  */
  label: {
    flexShrink: 1,
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
