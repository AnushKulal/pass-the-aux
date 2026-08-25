/**
 * The ambient ground.
 *
 * Three coloured blobs drifting slowly behind everything, and the single reason
 * the rest of this design works: cards in this direction are 5.5% white, so
 * without something alive underneath them they composite to a flat grey and the
 * whole surface stack collapses into one tone. This is what they are
 * translucent ONTO.
 *
 * Built from design/nocturne/aux-nocturne.dc.html L35-37 and the `auxDrift`
 * keyframes at L21.
 *
 * Drawn with react-native-svg rather than expo-linear-gradient because these are
 * RADIAL and that library only does linear. The dependency was already in
 * package.json with zero imports.
 *
 * The design also puts a 26-30px CSS blur on each blob. That is deliberately NOT
 * reproduced: `filter: blur()` has no dependable native equivalent, and a radial
 * gradient that is already transparent by 70% of its radius has no hard edge for
 * the blur to soften. Adding an SVG FeGaussianBlur would cost a real offscreen
 * pass on every frame of the drift to fix an edge that is not visible.
 */

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { useColors } from '@/lib/theme-context';

/** The drift, straight from the keyframes: a slow lean up and to the right. */
const DRIFT_X = 18;
const DRIFT_Y = -14;

type BlobSpec = {
  size: number;
  /** Exactly one of each axis, matching the design's own anchoring. */
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
  /** Full cycle in ms. The three are coprime-ish so they never resynchronise. */
  period: number;
  /** Blob B runs its animation in reverse; it drifts the other way instead. */
  reverse?: boolean;
};

const BLOBS: readonly BlobSpec[] = [
  { size: 300, left: -110, top: -70, period: 18000 },
  { size: 300, right: -120, top: 180, period: 23000, reverse: true },
  { size: 320, left: -70, bottom: -90, period: 27000 },
];

function Blob({ spec, color, index }: { spec: BlobSpec; color: string; index: number }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      // Held at rest rather than skipped: the blobs are the ground, not motion
      // decoration, so they must still be THERE when animation is turned off.
      t.value = 0;
      return;
    }
    t.value = withRepeat(
      withTiming(1, { duration: spec.period / 2, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [reduced, spec.period, t]);

  const drift = useAnimatedStyle(() => {
    const dir = spec.reverse ? -1 : 1;
    return {
      transform: [
        { translateX: t.value * DRIFT_X * dir },
        { translateY: t.value * DRIFT_Y * dir },
      ],
    };
  });

  const id = `auxBlob${index}`;

  return (
    <Animated.View
      style={[
        styles.blob,
        drift,
        {
          width: spec.size,
          height: spec.size,
          left: spec.left,
          right: spec.right,
          top: spec.top,
          bottom: spec.bottom,
        },
      ]}>
      <Svg width={spec.size} height={spec.size}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} />
            {/*
              Transparent at 70%, as the design has it. The stop colour must be
              the SAME hue at zero opacity rather than `transparent`: several
              renderers interpolate an unspecified stop through black, which
              rings a dark halo around every blob on a dark ground.
            */}
            <Stop offset="0.7" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx="50%" cy="50%" r="50%" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/**
 * Sits at the bottom of the stack, inside the themed root, above nothing.
 *
 * `pointerEvents="none"` on the container is load-bearing — this covers the
 * entire screen, and an earlier full-bleed overlay in this app silently ate
 * every tap in the app for exactly this reason.
 */
export function AmbientGround() {
  const C = useColors();
  const colors = [C.blobA, C.blobB, C.blobC];

  return (
    <View pointerEvents="none" style={styles.root}>
      {BLOBS.map((spec, i) => (
        <Blob key={i} spec={spec} color={colors[i]} index={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  blob: {
    position: 'absolute',
  },
});
