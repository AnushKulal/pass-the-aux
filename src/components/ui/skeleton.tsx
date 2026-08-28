/**
 * A loading block: `surface2`, rounded, breathing.
 *
 * The pulse is opacity only — no travelling sheen. A shimmer would need a
 * gradient sliding under a mask; a plain block that dims and lifts says "not
 * here yet" just as clearly, costs one animated opacity, and collapses cleanly
 * when the user has asked for less motion.
 *
 * `surface2` is 9% white and translucent, so a skeleton over the ambient ground
 * picks up whatever blob is drifting behind it. That is correct — it is the
 * same fill the real card will have, one step brighter.
 */

import { useEffect } from 'react';
import type { DimensionValue, StyleProp, ViewStyle } from 'react-native';
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
import { Radii } from '@/lib/theme';

export type SkeletonProps = {
  width: number | string;
  height: number;
  /**
   * The corner of the thing this is standing in for — `Radii.pill` for an
   * avatar, `Radii.md` for a compact row, 24 for a card.
   *
   * THIS IS HONOURED AGAIN. It was marked deprecated and silently ignored under
   * Patchbay, where every corner in the app was square, and eight call sites
   * kept passing a considered `Radii.xl` / `Radii.sm` / `Radii.button` into the
   * void. Corners are back, those call sites were right all along, and a
   * placeholder whose shape does not match what replaces it makes the swap
   * visible as a pop.
   */
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

const DIM = 0.45;
const BRIGHT = 0.9;

export function Skeleton({ width, height, radius = Radii.lg, style }: SkeletonProps) {
  const C = useColors();
  const reduced = useReducedMotion();
  const opacity = useSharedValue(DIM);

  useEffect(() => {
    if (reduced) {
      opacity.value = (DIM + BRIGHT) / 2;
      return;
    }
    opacity.value = withRepeat(
      withTiming(BRIGHT, { duration: 900, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => cancelAnimation(opacity);
  }, [reduced, opacity]);

  const breathe = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        // The contract types `width` loosely as `number | string`; ViewStyle wants
        // the narrower DimensionValue. Callers pass numbers or '60%'.
        { width: width as DimensionValue, height, borderRadius: radius, backgroundColor: C.surface2 },
        breathe,
        style,
      ]}
    />
  );
}
