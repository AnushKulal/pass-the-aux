import { useEffect } from 'react';
import { StyleSheet, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
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
import { Radius } from '@/lib/theme';

export type SkeletonProps = {
  width: number | string;
  height: number;
  /** @deprecated Radius is 0 everywhere in this direction. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

const DIM = 0.45;
const BRIGHT = 0.9;

/**
 * A loading block: `surface2`, square, breathing.
 *
 * The pulse is opacity only — no travelling sheen. A shimmer would need a
 * gradient, and this direction has none; a plain rectangle that dims and lifts
 * says "not here yet" just as clearly and collapses cleanly when the user has
 * asked for less motion.
 */
export function Skeleton({ width, height, style }: SkeletonProps) {
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
        styles.base,
        // The contract types `width` loosely as `number | string`; ViewStyle wants
        // the narrower DimensionValue. Callers pass numbers or '60%'.
        { width: width as DimensionValue, height, backgroundColor: C.surface2 },
        breathe,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius,
  },
});
