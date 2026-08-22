import { StyleSheet, View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';

import { useColors } from '@/lib/theme-context';
import { Radius, Rule } from '@/lib/theme';

export type ProgressBarProps = {
  progress: number;
  height?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Playback position, upload progress, vote tallies. `progress` is 0..1.
 *
 * 2px by default: on a Feed row the bar is a rule pinned to the bottom edge, not
 * a widget. The Session's transport passes 6. The fill is the accent because a
 * progress bar here is always measuring something that is *playing*.
 */
export function ProgressBar({ progress, height = Rule.major, color, style }: ProgressBarProps) {
  const C = useColors();

  // Position feeds can briefly overshoot the track duration (clock drift) or go
  // negative on a seek-to-zero, and a >100% width blows out the parent row.
  const clamped = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const percent = Math.round(clamped * 100);

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={[styles.track, { height, backgroundColor: C.track }, style]}>
      <View
        style={[
          styles.fill,
          {
            // Asserted rather than inferred: TS widens the template expression to
            // `string`, which ViewStyle's DimensionValue will not accept.
            width: `${percent}%` as DimensionValue,
            backgroundColor: color ?? C.live,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    borderRadius: Radius,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: Radius,
  },
});
