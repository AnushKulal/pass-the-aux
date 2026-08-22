import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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

import { BLURHASH_SURFACE } from '@/components/ui/blurhash';
import { Colors, Duration, Bloom as BloomColors, Fonts, PointerEvents } from '@/lib/theme';

export type AvatarProps = {
  uri?: string | null;
  name: string;
  size?: number;
  live?: boolean;
  speaking?: boolean;
};

/** The artboard draws the ring at 1.5px and the halo 6px outside the frame. */
const RING_WIDTH = 1.5;
const HALO_INSET = 6;

/**
 * Initials fallbacks, lit from the same album-art bloom as everything else.
 *
 * The first stop of each pair is the lightest pixel the gradient ever produces,
 * and each one was picked so Colors.text still clears 4.5:1 on it — 7.7:1, 4.7:1
 * and 5.3:1 respectively. Bloom.a and Bloom.b themselves are too light to carry
 * the initials (2.6:1 and 4.2:1), which is why the warm pair is darkened.
 * Deliberately no aqua: accent is reserved for live/playing/joinable.
 */
const TINTS: readonly (readonly [string, string])[] = [
  [Colors.primary, Colors.primaryDim],
  [BloomColors.c, '#2E4470'],
  ['#8A4E75', Colors.primaryDim],
];

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]?.[0] ?? '';
  const second = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

function tintFor(name: string): readonly [string, string] {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return TINTS[hash % TINTS.length] as readonly [string, string];
}

export function Avatar({ uri, name, size = 40, live = false, speaking = false }: AvatarProps) {
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);

  const animate = live && !reduced;
  const hasRing = live || speaking;

  useEffect(() => {
    if (!animate) {
      pulse.value = 0;
      return;
    }
    // 1600ms is far outside the 150-300ms micro-interaction band on purpose:
    // this is an ambient presence indicator, and a fast pulse reads as an error.
    pulse.value = withRepeat(
      withTiming(1, { duration: 1600, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    );
    return () => cancelAnimation(pulse);
  }, [animate, pulse]);

  const halo = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.6, 0]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.3]) }],
  }));

  const initials = useMemo(() => initialsFor(name), [name]);
  const tint = useMemo(() => tintFor(name), [name]);

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={live ? `${name}, live` : name}
      style={[styles.root, { width: size, height: size }]}>
      {animate ? (
        <Animated.View
          style={[
            styles.halo,
            { borderRadius: (size + HALO_INSET * 2) / 2 },
            halo,
            PointerEvents.none,
          ]}
        />
      ) : null}

      <View
        style={[
          styles.frame,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: hasRing ? RING_WIDTH : 0,
            /*
              Only `live` earns the accent. Speaking rings in ink — it is a
              transient state, not a claim that this person is playing something
              you can join.
            */
            borderColor: live ? Colors.accent : Colors.text,
          },
        ]}>
        <LinearGradient
          colors={tint}
          start={{ x: 0.15, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={[StyleSheet.absoluteFill, PointerEvents.none]}
        />

        {/* Initials sit under the image, so they double as the error fallback. */}
        <Text
          numberOfLines={1}
          style={[styles.initials, { fontSize: Math.max(11, Math.round(size * 0.38)) }]}>
          {initials}
        </Text>

        {uri ? (
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
            placeholder={{ blurhash: BLURHASH_SURFACE }}
            transition={Duration.base}
            accessibilityIgnoresInvertColors
          />
        ) : null}
      </View>
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
    top: -HALO_INSET,
    right: -HALO_INSET,
    bottom: -HALO_INSET,
    left: -HALO_INSET,
    borderWidth: RING_WIDTH,
    borderColor: Colors.accent,
  },
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: {
    fontFamily: Fonts.bodySemi,
    color: Colors.text,
    includeFontPadding: false,
  },
});
