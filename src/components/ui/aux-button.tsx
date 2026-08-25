/**
 * The Aux button.
 *
 * Built from design/nocturne/aux-nocturne.dc.html: the gradient CTA (L128,
 * L142), the glass secondary (L133-135), the small secondary (L1207) and the
 * coral notice pill (L100).
 *
 * NOCTURNE MOVES THE PRIMARY ACTION TO BLUE, AND THAT IS THE WHOLE ACCENT RULE:
 *   coral (`live`) says "this is happening right now"
 *   blue  (`pri`)  says "you do this"
 * A Join button on a live session is BLUE with a CORAL badge beside it. No one
 * element is ever painted in both. `pri` is the new default answer for a CTA;
 * `live` survives for the handful of controls that toggle a live STATE (record,
 * go live) rather than perform an action.
 *
 * - `pri`         — the gradient pill. `priTint` over `pill`, white label, on a
 *                   BLUE GLOW rather than a grey drop shadow. Matches
 *                   `PrimaryCta` in '@/components/auth/onboarding' exactly, so
 *                   the signed-out flow and the app share one primary button.
 * - `live`        — coral fill, `onLive` label (a warm near-black; white on
 *                   coral fails). State, not action.
 * - `liveOutline` — `liveWash` fill, `liveMid` edge, `liveText` label. The
 *                   design's coral notice pill.
 * - `bordered`    — the glass secondary: `surface` fill + 1px `rule`. The fill
 *                   is only 5.5% white, so the EDGE is what makes it a button —
 *                   dropping the border leaves an invisible control.
 * - `ghost`       — no fill and no border, `ink2` label.
 * - `danger`      — destructive, and it has its own hue again.
 *
 * Old names still compile. `primary` remains `bordered` (30+ call sites expect
 * an outline), but `accent` and `cream` now both resolve to `pri`: `accent`
 * meant "the reserved colour" when the reserved colour WAS the CTA colour, and
 * `cream` resolves to the same blue as `pill` in this palette, so leaving them
 * on `live` would paint actions coral in defiance of the rule above.
 */

import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
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
import { Duration, Fonts, Radii, Rule, Space, tracking, Type, type Palette } from '@/lib/theme';

export type AuxButtonVariant =
  | 'pri'
  | 'live'
  | 'liveOutline'
  | 'bordered'
  | 'ghost'
  | 'danger'
  /** @deprecated resolves to `pri` — an action is blue in this direction. */
  | 'accent'
  /** @deprecated resolves to `pri`; `cream` and `pill` are one colour now. */
  | 'cream'
  /** @deprecated alias for `bordered`. */
  | 'primary';

type ResolvedVariant = 'pri' | 'live' | 'liveOutline' | 'bordered' | 'ghost' | 'danger';

const ALIASES: Record<AuxButtonVariant, ResolvedVariant> = {
  pri: 'pri',
  live: 'live',
  liveOutline: 'liveOutline',
  bordered: 'bordered',
  ghost: 'ghost',
  danger: 'danger',
  accent: 'pri',
  cream: 'pri',
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
  /** Defaults to `pill`. `square` is the escape hatch, not the house shape. */
  shape?: AuxButtonShape;
  /** Defaults to `left` when there is an icon and `center` when there is not. */
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

/** How the label is set. Three registers, not two — see `labelStyleFor`. */
type LabelVoice = 'shout' | 'prose' | 'cta';

type Skin = {
  bg: string;
  bgPress: string;
  fg: string;
  border: string;
  borderPress: string;
  voice: LabelVoice;
  /**
   * The two ends of the vertical gradient, or null for a flat fill. Drawn as an
   * absolutely-positioned layer under the label rather than as the view's own
   * background, because `bg`/`bgPress` are what the border animation eases
   * between and a gradient has no single colour to interpolate from.
   */
  gradient: readonly [string, string] | null;
  /** A COLOURED bloom under the cell — light coming off it, not a drop shadow. */
  glow: string | null;
};

function skinFor(v: ResolvedVariant, C: Palette): Skin {
  switch (v) {
    case 'pri':
      /*
        The signature control of this direction. Pressed DIMS rather than
        recolours: there is no second blue in the palette to ease towards, and
        the glow underneath would keep the resting hue anyway and read as a halo
        that had come unstuck from its button.
      */
      return {
        bg: CLEAR,
        bgPress: CLEAR,
        fg: C.pillInk,
        border: CLEAR,
        borderPress: CLEAR,
        voice: 'cta',
        gradient: [C.priTint, C.pill],
        glow: C.glow,
      };
    case 'live':
      // Pressed goes *brighter*, not darker — `liveText` is the same hue lifted.
      return {
        bg: C.live,
        bgPress: C.liveText,
        fg: C.onLive,
        border: CLEAR,
        borderPress: CLEAR,
        voice: 'shout',
        gradient: null,
        glow: C.glowSoft,
      };
    case 'liveOutline':
      return {
        bg: C.liveWash,
        bgPress: C.liveMid,
        fg: C.liveText,
        border: C.liveMid,
        borderPress: C.live,
        voice: 'shout',
        gradient: null,
        glow: null,
      };
    case 'danger':
      return {
        bg: C.dangerWash,
        bgPress: C.dangerBorder,
        fg: C.danger,
        border: C.dangerBorder,
        borderPress: C.danger,
        voice: 'shout',
        gradient: null,
        glow: null,
      };
    case 'ghost':
      return {
        bg: CLEAR,
        bgPress: C.surface2,
        fg: C.ink2,
        border: CLEAR,
        borderPress: CLEAR,
        voice: 'prose',
        gradient: null,
        glow: null,
      };
    case 'bordered':
    default:
      /*
        `surface` is 5.5% white, so this cell has almost no fill of its own and
        the 1px `rule` edge is what actually draws a button. Stacking one inside
        a `surface` card composites to ~11%, which is right here — a button
        SHOULD sit slightly proud of the card it is in.
      */
      return {
        bg: C.surface,
        bgPress: C.surface2,
        fg: C.ink,
        border: C.rule,
        borderPress: C.rule3,
        voice: 'prose',
        gradient: null,
        glow: null,
      };
  }
}

/**
 * Three heights, and they are the design's own: 46 for a control inside a row,
 * 50 for the compact secondary at L1207, 54 for the CTA at L128. `xl` is kept
 * as an alias of `lg` the way `lg` already aliases nothing taller — nocturne's
 * tallest button is 54, and `PillButton` (which asks for `xl`) is that button.
 */
const SIZES: Record<
  AuxButtonSize,
  { minHeight: number; paddingHorizontal: number; gap: number; icon: number; font: number }
> = {
  sm: { minHeight: 46, paddingHorizontal: Space.lg, gap: Space.sm, icon: 15, font: 12 },
  md: { minHeight: 50, paddingHorizontal: Space.xl, gap: Space.sm, icon: 18, font: 13 },
  lg: { minHeight: 54, paddingHorizontal: Space.xxl, gap: Space.md, icon: 20, font: 14 },
  xl: { minHeight: 54, paddingHorizontal: Space.xxl, gap: Space.md, icon: 20, font: 14 },
};

/**
 * The glow is keyed to the button's HEIGHT, exactly as the artboards key it: a
 * 46px segment carries `0 6px 18px` (L117) and the 54px CTA carries
 * `0 10px 26px` (L128). One blur for both would either fog the small control or
 * leave the large one sitting flat on the page.
 */
function glowFor(height: number, color: string): object {
  const [offsetY, blurRadius] = height >= 52 ? [10, 26] : [6, 18];
  return { boxShadow: [{ offsetX: 0, offsetY, blurRadius, color }] };
}

/**
 * Three registers, because nocturne's CTA is NOT a shouted label.
 *
 * `shout` is the uppercase, widely-tracked accent voice. `cta` is the design's
 * primary-button setting — extrabold at +0.03em but sentence case, because the
 * artboards read "Get started" and "Sign in", not "GET STARTED". `prose` is the
 * quiet secondary at 600.
 */
function labelStyleFor(voice: LabelVoice, font: number) {
  if (voice === 'shout') {
    return {
      ...Type.heading(font),
      letterSpacing: tracking(font, 0.1),
      textTransform: 'uppercase' as const,
    };
  }
  if (voice === 'cta') {
    return {
      fontFamily: Fonts.extrabold,
      fontSize: font,
      lineHeight: Math.round(font * 1.25),
      letterSpacing: tracking(font, 0.03),
    };
  }
  return {
    fontFamily: Fonts.semibold,
    fontSize: font,
    lineHeight: Math.round(font * 1.25),
    letterSpacing: tracking(font, 0.06),
  };
}

export function AuxButton({
  label,
  onPress,
  variant = 'bordered',
  size = 'md',
  shape = 'pill',
  align,
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
    Every button in the artboards is a full pill, and the two defaults have to
    move together: a 54px pill with a flush-left label leaves the first letter
    sitting inside the curve. So the label centres unless there is a leading
    icon, which is the one case the design draws flush left (the provider rows
    at L133-135: icon, gap, then `text-align:left`).
  */
  const centred = (align ?? (Icon ? 'left' : 'center')) === 'center';
  const radius = shape === 'pill' ? Radii.pill : Radii.lg;

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

  return (
    <Animated.View
      style={[
        styles.base,
        animated,
        { borderRadius: radius, minHeight: s.minHeight },
        skin.glow ? glowFor(s.minHeight, skin.glow) : null,
        fullWidth && styles.fullWidth,
        blocked && styles.blocked,
        // A gradient variant dims under the finger instead of recolouring.
        pressed && !blocked && skin.gradient ? styles.held : null,
      ]}>
      {/*
        The gradient carries its OWN radius rather than being clipped by the
        parent: `overflow: 'hidden'` would be the alternative, and on Android a
        clipping parent that also casts a shadow drops the shadow entirely.

        It bleeds one pixel past every edge because absolute insets are measured
        from the PADDING box — inside the hairline border every variant carries.
        At zero it would leave a 1px transparent ring around the fill, which on
        a pale ground reads as a gap between the button and its own glow.
      */}
      {skin.gradient ? (
        <LinearGradient
          colors={skin.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[styles.gradient, { borderRadius: radius }]}
        />
      ) : null}

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
          centred && styles.hitCenter,
          { minHeight: s.minHeight, paddingHorizontal: s.paddingHorizontal, gap: s.gap },
        ]}>
        {loading ? (
          <ActivityIndicator size="small" color={skin.fg} />
        ) : Icon ? (
          <Icon size={s.icon} strokeWidth={2} color={skin.fg} />
        ) : null}

        <Text
          numberOfLines={1}
          style={[styles.label, labelStyleFor(skin.voice, s.font), { color: skin.fg }]}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The full-width hero button: a centred label in a fully rounded 54px cell.
 *
 * The four layout props are omitted rather than defaulted, because a
 * `PillButton` that could be handed `shape="square"` is just `AuxButton` with
 * extra steps. `variant` stays open but now defaults to `pri` — a hero button
 * is the action a screen is asking for, and in nocturne that is blue.
 */
export type PillButtonProps = Omit<AuxButtonProps, 'shape' | 'align' | 'size' | 'fullWidth'>;

export function PillButton({ variant = 'pri', ...rest }: PillButtonProps) {
  return <AuxButton {...rest} variant={variant} shape="pill" align="center" size="xl" fullWidth />;
}

const styles = StyleSheet.create({
  base: {
    // Held at 1 on every variant so swapping variants never changes layout.
    borderWidth: Rule.hair,
    alignSelf: 'flex-start',
    // The gradient is an absolutely-positioned CHILD, so the box has to be a
    // containing block or it would fill the nearest positioned ancestor.
    position: 'relative',
  },
  gradient: {
    position: 'absolute',
    top: -Rule.hair,
    left: -Rule.hair,
    right: -Rule.hair,
    bottom: -Rule.hair,
  },
  hit: {
    flexDirection: 'row',
    alignItems: 'center',
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
  /** Matches `PrimaryCta`'s press, so the two primaries feel identical. */
  held: {
    opacity: 0.9,
  },
});
