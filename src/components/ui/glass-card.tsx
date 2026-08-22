import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useColors } from '@/lib/theme-context';
import { Radius, Rule, Space } from '@/lib/theme';

export type GlassCardProps = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * @deprecated There is no blur in Patchbay. Accepted and ignored so the call
   * sites that still pass it keep compiling.
   */
  intensity?: number;
  padded?: boolean;
};

export type PanelProps = GlassCardProps;

/**
 * A flat panel: `surface` ground, one 1px `rule2` border, square corners.
 *
 * This file used to hold the glass card. There is no glass in this direction —
 * no blur, no tint, no shadow — and separation is done with the border and the
 * step in ground colour instead. The name `GlassCard` survives only because
 * twenty-odd call sites import it; `Panel` is the name to use in new code.
 */
export function GlassCard({ children, style, padded = true }: GlassCardProps) {
  const C = useColors();

  return (
    <View
      style={[
        styles.root,
        { backgroundColor: C.surface, borderColor: C.rule2 },
        padded && styles.padded,
        style,
      ]}>
      {children}
    </View>
  );
}

/** The name this component should be called by from here on. */
export const Panel = GlassCard;

const styles = StyleSheet.create({
  root: {
    borderRadius: Radius,
    borderWidth: Rule.hair,
  },
  padded: {
    padding: Space.md,
  },
});
