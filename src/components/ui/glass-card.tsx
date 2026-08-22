import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, PointerEvents, Radius, Space } from '@/lib/theme';

export type GlassCardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  padded?: boolean;
};

/**
 * The app's primary surface: a frosted block over the indigo background.
 *
 * Blur is treated as decoration, never as the thing that makes text readable —
 * see the opaque floor below.
 */
export function GlassCard({ children, style, intensity = 40, padded = true }: GlassCardProps) {
  return (
    <View style={[styles.root, style]}>
      {/*
        Opaque floor. expo-blur degrades to a nearly transparent view on web and
        on Android (blurMethod defaults to 'none'), and glass-over-bg alone drops
        body text under the 4.5:1 floor. Painting Colors.surface underneath keeps
        contrast identical on every platform; the blur only adds depth on iOS.
      */}
      <View style={[StyleSheet.absoluteFill, styles.solid, PointerEvents.none]} />
      <BlurView
        tint="dark"
        intensity={intensity}
        style={[StyleSheet.absoluteFill, PointerEvents.none]}
      />
      <View style={[StyleSheet.absoluteFill, styles.tint, PointerEvents.none]} />

      <View style={padded ? styles.padded : undefined}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  solid: {
    backgroundColor: Colors.surface,
  },
  tint: {
    backgroundColor: Colors.glass,
  },
  padded: {
    padding: Space.lg,
  },
});
