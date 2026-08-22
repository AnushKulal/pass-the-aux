import { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Bloom as BloomColors, PointerEvents } from '@/lib/theme';

export type BloomProps = {
  /** Diameter of the square the bloom occupies. Default 320. */
  size?: number;
  /**
   * Peak alpha at the centre, 0..1. Default 0.4 — the value SYSTEM.md draws the
   * bloom at. Settings screens sit further from the artwork and want ~0.2.
   */
  opacity?: number;
  /** Positioning. The root is already `position: absolute`; pass offsets here. */
  style?: StyleProp<ViewStyle>;
};

/**
 * Signature element #1 — the artwork lighting the room.
 *
 * React Native has no radial gradient and no CSS blur, so the softness is faked
 * with concentric translucent circles whose coverage accumulates toward the
 * centre. Two details make it read as a blur rather than as a dartboard:
 *
 * - Every layer carries the *same* alpha, so the accumulated profile is a smooth
 *   exponential ramp and each visible step is only that one alpha.
 * - That alpha is solved backwards from `opacity` — a = 1 - (1 - peak)^(1/n) —
 *   so a 12-layer and a 26-layer bloom peak at the same place, and the per-step
 *   colour delta stays around 4-8/255 on the ground. Below the banding floor.
 *
 * Layer count tracks `size` to hold each band near 14px: a 150px bloom does not
 * need the 26 circles a 700px one does, and blooms are cheap only if small ones
 * stay small.
 *
 * Colours come from `Bloom` — decorative only, never semantic. Deliberately no
 * `Colors.accent`: the bloom is atmosphere, the accent means "live".
 *
 * Always decorative: hidden from screen readers and untouchable. Render it as
 * the first child of the thing it lights (later siblings paint on top in RN),
 * including inside a GlassCard, which is how the artboards tint their panels.
 */
export function Bloom({ size = 320, opacity = 0.4, style }: BloomProps) {
  const layers = useMemo(() => build(size, opacity), [size, opacity]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.root, { width: size, height: size }, style, PointerEvents.none]}>
      {layers.map((layer) => (
        <View
          key={layer.key}
          style={{
            position: 'absolute',
            width: layer.d,
            height: layer.d,
            borderRadius: layer.d / 2,
            backgroundColor: layer.color,
          }}
        />
      ))}
    </View>
  );
}

/** Target width of one band, in px. */
const BAND = 14;
const MIN_LAYERS = 10;
const MAX_LAYERS = 26;
/** Innermost circle, as a fraction of `size`. */
const CORE = 0.2;

function build(size: number, peak: number) {
  const clamped = Math.min(0.95, Math.max(0, peak));
  const count = Math.max(MIN_LAYERS, Math.min(MAX_LAYERS, Math.round(size / BAND)));
  // Stacking `count` layers of alpha `a` composites to 1 - (1 - a)^count, so
  // solve for the a that lands exactly on the requested peak.
  const alpha = 1 - Math.pow(1 - clamped, 1 / count);

  const out: { key: number; d: number; color: string }[] = [];

  for (let i = 0; i < count; i += 1) {
    // 0 at the rim, 1 at the core.
    const t = i / (count - 1);
    /*
      SYSTEM.md's stops are pink at 0%, violet at 42%, gone by 70% of the radius.
      Inverted through d = 1 - t * 0.8 that lands on t > 0.62 and t > 0.18; the
      outermost sliver takes the cool stop so the bloom falls off into the ground
      rather than stopping on a warm edge.
    */
    const hex = t > 0.62 ? BloomColors.a : t > 0.18 ? BloomColors.b : BloomColors.c;

    out.push({
      key: i,
      d: size * (1 - t * (1 - CORE)),
      color: withAlpha(hex, alpha),
    });
  }

  return out;
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(4)})`;
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
