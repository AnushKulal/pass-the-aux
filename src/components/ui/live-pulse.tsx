import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
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

import { useColors } from '@/lib/theme-context';
import { Radius } from '@/lib/theme';

export type LivePulseProps = {
  size?: number;
  color?: string;
};

/** The halo needs room to expand without clipping its parent row. */
const HALO_SCALE = 2.6;

/**
 * The square mark inside a LIVE badge.
 *
 * Purely decorative — the badge's own text carries the meaning — so it is
 * hidden from screen readers. The expanding ghost behind it is a square too:
 * there are no round corners anywhere in this direction, and a circle here
 * would be the one soft edge on the screen.
 */
export function LivePulse({ size = 8, color }: LivePulseProps) {
  const C = useColors();
  const reduced = useReducedMotion();
  const wave = useSharedValue(0);
  const paint = color ?? C.live;

  useEffect(() => {
    if (reduced) {
      wave.value = 0;
      return;
    }
    // Slow on purpose: a heartbeat, not a micro-interaction.
    wave.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    );
    return () => cancelAnimation(wave);
  }, [reduced, wave]);

  const halo = useAnimatedStyle(() => ({
    opacity: interpolate(wave.value, [0, 1], [0.45, 0]),
    transform: [{ scale: interpolate(wave.value, [0, 1], [0.4, 1]) }],
  }));

  const box = size * HALO_SCALE;

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.root, { width: box, height: box }]}>
      {reduced ? null : (
        <Animated.View
          style={[styles.halo, { width: box, height: box, backgroundColor: paint }, halo]}
        />
      )}
      <View style={{ width: size, height: size, borderRadius: Radius, backgroundColor: paint }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  halo: {
    position: 'absolute',
    borderRadius: Radius,
  },
});
