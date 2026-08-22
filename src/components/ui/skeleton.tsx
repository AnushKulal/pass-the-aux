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

import { Colors, Radius } from '@/lib/theme';

export type SkeletonProps = {
  width: number | string;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
};

const DIM = 0.4;
const BRIGHT = 0.8;

export function Skeleton({ width, height, radius = Radius.sm, style }: SkeletonProps) {
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

  const shimmer = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.base,
        // The contract types `width` loosely as `number | string`; ViewStyle wants
        // the narrower DimensionValue. Callers pass numbers or '60%'.
        { width: width as DimensionValue, height, borderRadius: radius },
        shimmer,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    backgroundColor: Colors.surfaceRaised,
  },
});
