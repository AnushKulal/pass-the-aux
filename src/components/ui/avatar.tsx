import { Image } from 'expo-image';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BLURHASH_SURFACE } from '@/components/ui/blurhash';
import { useColors } from '@/lib/theme-context';
import { Duration, Fonts, Radius, Rule } from '@/lib/theme';

export type AvatarProps = {
  uri?: string | null;
  name: string;
  size?: number;
  live?: boolean;
  speaking?: boolean;
};

/**
 * A square well with one letter in it.
 *
 * Patchbay has no circles and no gradients: the fallback is the flat `avatar`
 * ground with a single extrabold initial, which is exactly what the prototype
 * draws at every size from 16 to 132. The ring is the only variable — 2px of
 * accent when this person is live or speaking, nothing otherwise, because the
 * red is the whole signal and a permanent ring would spend it.
 */
const RING = 2;

function initialFor(name: string): string {
  const trimmed = name.trim();
  return trimmed ? (trimmed[0] as string).toUpperCase() : '?';
}

export function Avatar({ uri, name, size = 40, live = false, speaking = false }: AvatarProps) {
  const C = useColors();
  const initial = useMemo(() => initialFor(name), [name]);
  const ringed = live || speaking;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={live ? `${name}, live` : name}
      style={[
        styles.frame,
        {
          width: size,
          height: size,
          backgroundColor: C.avatar,
          // Border is inset in React Native, so the box stays exactly `size`
          // whether or not the ring is showing.
          borderWidth: ringed ? RING : 0,
          borderColor: ringed ? C.live : 'transparent',
        },
      ]}>
      {/* The initial sits under the image, so it doubles as the error fallback. */}
      <Text
        numberOfLines={1}
        style={[
          styles.initial,
          { color: C.ink2, fontSize: Math.max(10, Math.round(size * 0.4)) },
        ]}>
        {initial}
      </Text>

      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          cachePolicy="memory-disk"
          placeholder={{ blurhash: BLURHASH_SURFACE }}
          transition={Duration.press}
          accessibilityIgnoresInvertColors
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius,
    borderWidth: Rule.hair,
    overflow: 'hidden',
  },
  initial: {
    fontFamily: Fonts.extrabold,
    includeFontPadding: false,
  },
});
