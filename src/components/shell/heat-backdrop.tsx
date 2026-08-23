/**
 * The heat — Apex's signature.
 *
 * A gradient that sits BEHIND a screen's content, entering from one corner and
 * falling away to ground. It is the thing that makes the direction recognisable,
 * and the thing most easily overdone, so two rules govern it:
 *
 *   1. It lights roughly the top third and then gets out of the way. Content
 *      sits on the dark part. A gradient behind everything is wallpaper.
 *   2. One per screen. Two competing light sources read as a rendering bug
 *      rather than as atmosphere.
 *
 * Decorative and non-interactive: it never intercepts a touch.
 *
 * Cheap to render — a single native gradient layer, no blur, no animation by
 * default — so it can go on every screen without a frame cost.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import {
  GradientDirection,
  GradientLocations,
  gradientStops,
  PointerEvents,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

type Props = {
  /**
   * How far down the screen the heat reaches, as a fraction of the parent.
   * Defaults to 0.55 — past about two thirds it stops reading as a light
   * source and starts reading as a background image.
   */
  extent?: number;
  /**
   * Overall strength. Below 1 the whole layer fades toward the ground colour,
   * for screens where the content needs to dominate (Settings, a DM thread).
   */
  intensity?: number;
  /** `corner` by default; `vertical` for wide surfaces where a diagonal bands. */
  direction?: keyof typeof GradientDirection;
  style?: StyleProp<ViewStyle>;
};

export function HeatBackdrop({
  extent = 0.55,
  intensity = 1,
  direction = 'corner',
  style,
}: Props) {
  const C = useColors();
  const { start, end } = GradientDirection[direction];

  return (
    <View style={[styles.layer, { height: `${Math.round(extent * 100)}%` }, style]} {...PointerEvents.none}>
      <LinearGradient
        colors={gradientStops(C)}
        locations={GradientLocations}
        start={start}
        end={end}
        style={[StyleSheet.absoluteFill, intensity < 1 ? { opacity: intensity } : null]}
      />
      {/*
        The gradient's last stop is the amber, which would otherwise end on a
        hard horizontal edge halfway down the screen. This fades its bottom into
        the ground so the heat dissipates instead of stopping.
      */}
      <LinearGradient
        colors={['transparent', C.bg]}
        start={{ x: 0.5, y: 0.45 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});
