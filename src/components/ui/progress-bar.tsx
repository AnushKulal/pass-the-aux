import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Radius } from '@/lib/theme';

export type ProgressBarProps = {
  progress: number;
  height?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
};

/** Playback position, upload progress, vote tallies. `progress` is 0..1. */
export function ProgressBar({
  progress,
  height = 6,
  color = Colors.accent,
  style,
}: ProgressBarProps) {
  // Position feeds can briefly overshoot the track duration (clock drift) or go
  // negative on a seek-to-zero, and a >100% width blows out the parent row.
  const clamped = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const percent = Math.round(clamped * 100);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={[styles.track, { height, borderRadius: Radius.pill }, style]}>
      <View
        style={[
          styles.fill,
          {
            // Asserted rather than inferred: TS widens the template expression to
            // `string`, which ViewStyle's DimensionValue will not accept.
            width: `${percent}%` as DimensionValue,
            backgroundColor: color,
            borderRadius: Radius.pill,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    // The unplayed run is a hairline, not a block: it has to read as the ruler
    // the accent fill is measured against.
    backgroundColor: Colors.border,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
});
