/**
 * The breathing live dot.
 *
 * `@keyframes livedot` from design/v2/aux-v2.dc.html: a 2.2s cycle easing
 * opacity 1 → .3 and scale 1 → .72 and back. `withRepeat(..., true)` reverses,
 * so the timing here is half the cycle.
 *
 * Purely decorative — the count or label beside it always carries the meaning —
 * so it is hidden from screen readers and collapses to a static dot under
 * reduced motion.
 *
 * It lives beside the Feed rather than in the UI kit because the Feed, Explore
 * and Lounges are the three screens that draw it and the kit's barrel belongs
 * to another lane.
 */

import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Radii } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** Half of the design's 2.2s cycle; the repeat reverses for the other half. */
const HALF_CYCLE_MS = 1100;

export type LiveDotProps = {
  size?: number;
  /**
   * Draws the dot as a badge punched out of the surface behind it — the ring is
   * that surface's colour, never a new one.
   */
  ringColor?: string;
  ringWidth?: number;
};

export function LiveDot({ size = 7, ringColor, ringWidth = 2.5 }: LiveDotProps) {
  const C = useColors();
  const reduced = useReducedMotion();
  const beat = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      beat.value = 0;
      return;
    }
    beat.value = withRepeat(
      withTiming(1, { duration: HALF_CYCLE_MS, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
    return () => cancelAnimation(beat);
  }, [reduced, beat]);

  const pulse = useAnimatedStyle(() => ({
    opacity: interpolate(beat.value, [0, 1], [1, 0.3]),
    transform: [{ scale: interpolate(beat.value, [0, 1], [1, 0.72]) }],
  }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.dot,
        { width: size, height: size, backgroundColor: C.live },
        ringColor ? { borderWidth: ringWidth, borderColor: ringColor } : null,
        pulse,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    borderRadius: Radii.pill,
  },
});
