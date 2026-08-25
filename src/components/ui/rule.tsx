/**
 * The horizontal divider.
 *
 * Its job SHRANK in this direction, and the header comment is most of what
 * changed. Patchbay separated everything with lines and steps in ground colour;
 * Nocturne separates with a card — a translucent fill, a 1px edge and a shadow
 * — so a line is no longer how one region of a screen is told from the next.
 *
 * `design/nocturne/aux-nocturne.dc.html` proves it by counting: twelve
 * hairlines in the whole document, all of them `--aux-rule-s` at 1px, all of
 * them BETWEEN ROWS INSIDE ONE CARD (L88–90, L1002, L1183). Zero rules across a
 * screen, zero under a header, zero at 2px.
 *
 * So `hair` is the rule you want, effectively always, and it is the default.
 * `major` survives for the handful of places a screen genuinely has no card to
 * do the separating — settings groups, mostly. Reaching for it inside a card
 * puts a 2px line in a design that has none, which reads as a mistake rather
 * than as emphasis.
 *
 * Decorative by definition — the structure it draws is already carried by the
 * headings around it, so it is hidden from screen readers.
 */

import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useColors } from '@/lib/theme-context';
import { Rule as RuleWeight } from '@/lib/theme';

export type RuleWeightName = 'hair' | 'major';

export type RuleProps = {
  /**
   * `hair` — 1px `ruleSoft`, between rows inside one card. The design's only
   * divider, and the default.
   * `major` — 2px `rule`, for a screen-level break with no card to carry it.
   */
  weight?: RuleWeightName;
  /**
   * Override the line colour. Use sparingly, and mind the accent rule: a coral
   * line says the thing beside it is LIVE, a blue one says it is an action.
   */
  color?: string;
  style?: StyleProp<ViewStyle>;
};

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
