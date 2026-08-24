/**
 * The aux wordmark.
 *
 * Built from design/v2/Aux Icons.dc.html — the same mark the launcher icon,
 * the adaptive icon and the favicon are cut from, so the thing on the home
 * screen and the thing inside the app are one design rather than two.
 *
 * `aux` set in Archivo 800 at −0.07em, with a dot trailing it on the baseline.
 * The dot is the only accent the mark carries, and it is the reason the mark
 * reads as a MARK rather than as the word: a full stop that happens to be red.
 *
 * ONE RULE, and it is what keeps the mark from drifting: every dimension is a
 * ratio of `size`, taken from the artboard's own 64px board. Nothing here is a
 * magic number that has to be re-tuned when the mark is used bigger or smaller.
 */

import { StyleSheet, Text, View } from 'react-native';

import { Fonts, Radii, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/** Ratios from the artboard's 64px wordmark board. */
const DOT = 13 / 64;
const GAP = 9 / 64;
/** How far the dot sits above the baseline the letters rest on. */
const LIFT = 6 / 64;

export type WordmarkProps = {
  /** Cap size of the lettering. Everything else derives from it. */
  size?: number;
  /** Override the ink — for a mark drawn on artwork or an accent fill. */
  color?: string;
  /**
   * Draw the dot in the ink colour rather than the accent.
   *
   * For the monochrome contexts the design calls out — a notification glyph, a
   * single-colour print — where a second hue would be dropped anyway.
   */
  mono?: boolean;
  /** The one-letter form. Three letters below ~20px lose the dot's floor. */
  monogram?: boolean;
};

export function Wordmark({ size = 64, color, mono = false, monogram = false }: WordmarkProps) {
  const C = useColors();

  const ink = color ?? C.ink;
  const dot = Math.round(size * DOT);

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="aux"
      style={styles.row}>
      <Text
        style={{
          fontFamily: Fonts.extrabold,
          fontSize: size,
          // 0.8 line height, per the board: the mark is set tight so the dot
          // has a baseline to sit on rather than floating in leading.
          lineHeight: size * 0.8,
          letterSpacing: tracking(size, -0.07),
          color: ink,
        }}>
        {monogram ? 'a' : 'aux'}
      </Text>

      <View
        style={{
          width: dot,
          height: dot,
          borderRadius: Radii.pill,
          backgroundColor: mono ? ink : C.live,
          marginLeft: Math.round(size * GAP),
          marginBottom: Math.round(size * LIFT),
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    // flex-end, not center: the dot aligns to the letters' baseline, which is
    // what makes it read as punctuation rather than as a bullet beside a word.
    alignItems: 'flex-end',
  },
});
