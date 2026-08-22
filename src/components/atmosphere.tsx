/**
 * Screen atmosphere — the bloom and the grid.
 *
 * Deliberately not part of `components/ui`: nothing in here is interactive,
 * nothing in here carries meaning, and every layer is `PointerEvents.none`.
 * The UI kit is a set of controls; this is weather.
 *
 * Both layers are absolutely positioned against whatever they are dropped
 * into, and both bleed past their parent's gutters on purpose — the direction
 * asks for a glow that runs off the edges of the screen, not a rectangle that
 * stops at the padding.
 */

import { LinearGradient } from 'expo-linear-gradient';
import { memo, useMemo } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { Bloom, Colors, PointerEvents } from '@/lib/theme';

/**
 * `#RRGGBB` token to an rgba string.
 *
 * `bloomGradient()` in the theme bakes in the a→b pair; the Feed needs to
 * rotate which bloom hue leads so the screen is tinted by whatever artwork is
 * at the top of it. Same stops, one more degree of freedom.
 */
function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** The ground, fully transparent — where every bloom stop resolves to. */
const CLEAR = withAlpha(Colors.bg, 0);

/**
 * Which two bloom colours lead. Decorative only: rotating these is exactly
 * why `Colors.accent` is free to mean one thing.
 */
const HUES = [
  [Bloom.a, Bloom.b],
  [Bloom.b, Bloom.c],
  [Bloom.c, Bloom.a],
] as const;

/**
 * A stable hue per artwork. Sampling the real dominant colour would mean
 * decoding every remote image on the Feed's critical path; hashing its URL
 * gets the same "every room is lit differently, and it stays lit the same way"
 * result for free, and it cannot flicker while an image loads.
 */
function hueFor(seed: string | null | undefined): number {
  if (!seed) return 0;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash % HUES.length;
}

export type BloomBackdropProps = {
  /** Usually the top row's artwork URL. Null keeps the default a→b pair. */
  seed?: string | null;
  /** Alpha at the core. 0.4 on artwork-led screens, ~0.22 where there is none. */
  intensity?: number;
  /** Height of the glow field. */
  height?: number;
  /** How far the core sits above the top of the parent, so it bleeds off-screen. */
  rise?: number;
  /**
   * How far past the parent's gutters the field runs. The horizontal mask below
   * resolves to solid ground at its own edges; pushing those edges off-screen is
   * what stops the fake radial from reading as a band.
   */
  spread?: number;
};

/**
 * The bloom: a large soft radial glow behind the artwork, bleeding up off the
 * top of the screen.
 *
 * React Native has no radial gradient and no blur filter, so this is two linear
 * gradients composited: a vertical one that carries the colour and the falloff,
 * and a horizontal one that paints the ground back in at the sides. The product
 * of the two reads as a blurred ellipse, and both are native gradient views
 * rather than stacked translucent circles, so there is no banding.
 */
const GLOW_STOPS = [0, 0.34, 0.6, 1] as const;
/** Ground painted back in at the sides, which is what turns the linear ramp into a blob. */
const EDGE_MASK = [Colors.bg, CLEAR, Colors.bg] as const;
const EDGE_STOPS = [0, 0.5, 1] as const;
const EDGE_START = { x: 0, y: 0.5 } as const;
const EDGE_END = { x: 1, y: 0.5 } as const;

export const BloomBackdrop = memo(function BloomBackdrop({
  seed = null,
  intensity = 0.4,
  height = 420,
  rise = 64,
  spread = 96,
}: BloomBackdropProps) {
  const glow = useMemo(() => {
    const pair = HUES[hueFor(seed)] ?? HUES[0];
    const core = pair[0];
    const outer = pair[1];

    return [
      // Above the core: already fading, because most of it is off-screen.
      withAlpha(core, intensity * 0.45),
      withAlpha(core, intensity),
      withAlpha(outer, intensity * 0.55),
      CLEAR,
    ] as const;
  }, [seed, intensity]);

  return (
    <View
      style={[styles.bloom, { top: -rise, left: -spread, right: -spread, height }, PointerEvents.none]}>
      <LinearGradient colors={glow} locations={GLOW_STOPS} style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={EDGE_MASK}
        locations={EDGE_STOPS}
        start={EDGE_START}
        end={EDGE_END}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
});

export type GridOverlayProps = {
  /** Lattice pitch. 25 is the system's. */
  size?: number;
  /** Vertical bleed past the parent, so the lattice covers the header too. */
  rise?: number;
  /** Horizontal bleed past the parent's gutters. */
  spread?: number;
};

const GRID_SIZE = 25;
/**
 * 1dp, not `StyleSheet.hairlineWidth`: `Colors.grid` is 2.8% white, and a third
 * of a pixel of that on a 3x screen resolves to nothing at all.
 */
const GRID_LINE = 1;

/**
 * The grid. Session and Feed only — it is what makes those two screens read as
 * instrumentation rather than decoration, and it means nothing anywhere else.
 */
export const GridOverlay = memo(function GridOverlay({
  size = GRID_SIZE,
  rise = 140,
  spread = 32,
}: GridOverlayProps) {
  const window = useWindowDimensions();

  const columns = useMemo(() => {
    const span = window.width + spread * 2;
    return Array.from({ length: Math.ceil(span / size) }, (_, i) => i * size);
  }, [window.width, size, spread]);

  const rows = useMemo(() => {
    const span = window.height + rise * 2;
    return Array.from({ length: Math.ceil(span / size) }, (_, i) => i * size);
  }, [window.height, size, rise]);

  return (
    <View
      style={[
        styles.grid,
        { top: -rise, bottom: -rise, left: -spread, right: -spread },
        PointerEvents.none,
      ]}>
      {columns.map((x) => (
        <View key={`c${x}`} style={[styles.column, { left: x }]} />
      ))}
      {rows.map((y) => (
        <View key={`r${y}`} style={[styles.row, { top: y }]} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  bloom: {
    position: 'absolute',
    overflow: 'hidden',
  },
  grid: {
    position: 'absolute',
    overflow: 'hidden',
  },
  column: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: GRID_LINE,
    backgroundColor: Colors.grid,
  },
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: GRID_LINE,
    backgroundColor: Colors.grid,
  },
});
