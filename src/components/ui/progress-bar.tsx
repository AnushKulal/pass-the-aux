/**
 * Playback position, upload progress, vote tallies. `progress` is 0..1.
 *
 * From design/nocturne/aux-nocturne.dc.html: the 6px transport bar with its
 * thumb at L930-932, and the 4px bar on a feed row at L995.
 *
 * THE FILL IS A CORAL GRADIENT, not a flat accent — `live` into `liveText`,
 * left to right, which reads as the bar warming as it fills. It is coral rather
 * than blue for the same reason everything else here is: a progress bar is
 * always measuring something that is PLAYING, and playing is state.
 *
 * Nothing here clips. The track used to carry `overflow: 'hidden'` to round the
 * fill's leading edge; the fill now carries its own pill radius instead,
 * because a clipping track would eat both the fill's glow and the thumb — the
 * two things this direction added.
 */

import { LinearGradient } from 'expo-linear-gradient';
import {
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useColors } from '@/lib/theme-context';
import { Radii } from '@/lib/theme';

export type ProgressBarProps = {
  progress: number;
  /** 4 on a feed row (L995), 6 on the transport (L930). */
  height?: number;
  /** Forces a FLAT fill in this colour, replacing the coral gradient. */
  color?: string;
  /** The coral bleed under the fill. On for a transport, off in a list. */
  glow?: boolean;
  /** The draggable-looking head. Only for a bar someone can actually scrub. */
  thumb?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** L932: a 14px disc, so it overhangs a 6px track by 4px top and bottom. */
const THUMB = 14;

export function ProgressBar({
  progress,
  height = 4,
  color,
  glow = false,
  thumb = false,
  style,
}: ProgressBarProps) {
  const C = useColors();

  // Position feeds can briefly overshoot the track duration (clock drift) or go
  // negative on a seek-to-zero, and a >100% width blows out the parent row.
  const clamped = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const percent = Math.round(clamped * 100);
  const width = `${percent}%` as DimensionValue;

  /*
    `0 0 12px var(--aux-live-m)` (L931). Zero offset: the bar is lit, not
    raised. `liveMid` rather than `live` because at full strength a 6px bar
    smears a coral haze across the artwork above it.
  */
  const bleed = glow
    ? { boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 12, color: C.liveMid }] }
    : null;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={[styles.track, { height, backgroundColor: C.track }, style]}>
      {color ? (
        <View style={[styles.fill, bleed, { width, height, backgroundColor: color }]} />
      ) : (
        <LinearGradient
          colors={[C.live, C.liveText]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[styles.fill, bleed, { width, height }]}
        />
      )}

      {/*
        Positioned from its own LEFT edge and pulled back half its width, so the
        head sits centred on the fill's end rather than starting there — at 100%
        the difference is the whole thumb hanging off the right of the track.
        It overhangs vertically too: the row above owes it 4px of air.
      */}
      {thumb ? (
        <View
          style={[
            styles.thumb,
            {
              left: width,
              top: (height - THUMB) / 2,
              // Theme-aware rather than the design's literal white: a white
              // thumb on the light theme's pale track is invisible.
              backgroundColor: C.ink,
              boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 12, color: C.live }],
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    borderRadius: Radii.pill,
    justifyContent: 'center',
  },
  fill: {
    borderRadius: Radii.pill,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    marginLeft: -THUMB / 2,
    borderRadius: Radii.pill,
  },
});
