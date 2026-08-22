import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useColors } from '@/lib/theme-context';
import { Rule as RuleWeight } from '@/lib/theme';

export type RuleWeightName = 'hair' | 'major';

export type RuleProps = {
  /**
   * `hair` — 1px `ruleSoft`, between rows inside one group.
   * `major` — 2px `rule`, between one section of a screen and the next.
   */
  weight?: RuleWeightName;
  /** Override the line colour. Use sparingly; accent rules mean *live*. */
  color?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * The horizontal divider this whole direction leans on.
 *
 * Patchbay separates things with lines and steps in ground colour, never with
 * shadow or blur, and the weight carries the meaning: a hairline says "same
 * group, next item", a 2px rule says "different section". Getting that backwards
 * flattens the page into an undifferentiated list, so pick deliberately.
 *
 * Decorative by definition — the structure it draws is already carried by the
 * headings around it, so it is hidden from screen readers.
 */
export function Rule({ weight = 'hair', color, style }: RuleProps) {
  const C = useColors();
  const major = weight === 'major';

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.base,
        {
          height: major ? RuleWeight.major : RuleWeight.hair,
          backgroundColor: color ?? (major ? C.rule : C.ruleSoft),
        },
        style,
      ]}
    />
  );
}

/** Alias, for call sites that already import `Rule` from '@/lib/theme'. */
export const Divider = Rule;

const styles = StyleSheet.create({
  base: {
    alignSelf: 'stretch',
    width: '100%',
  },
});
