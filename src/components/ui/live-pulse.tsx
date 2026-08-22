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

import { Colors, Radius } from '@/lib/theme';

export type LivePulseProps = {
  size?: number;
  color?: string;
};

/** The halo needs room to expand without clipping its parent row. */
const HALO_SCALE = 2.6;

/**
 * The dot inside a "LIVE" badge. Purely decorative — the badge's own text
 * carries the meaning, so this is hidden from screen readers.
 */
export function LivePulse({ size = 8, color = Colors.accent }: LivePulseProps) {
  const reduced = useReducedMotion();
  const wave = useSharedValue(0);

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
          style={[
            styles.halo,
            { width: box, height: box, borderRadius: Radius.pill, backgroundColor: color },
            halo,
          ]}
        />
      )}
      <View
        style={{ width: size, height: size, borderRadius: Radius.pill, backgroundColor: color }}
      />
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
  },
});
