/**
 * The aux wordmark.
 *
 * `aux` set in Archivo 800 at -0.05em, filled with a warm-to-cool GRADIENT, and
 * a glowing dot trailing it on the baseline. The dot is what makes the mark read
 * as a mark rather than as the word: a full stop that happens to be red.
 *
 * Built from design/nocturne/aux-nocturne.dc.html L49 (62px), L111 (54px) and
 * L650 (22px) — three sizes of one mark, which is where the ratios below come
 * from.
 *
 * WHAT CHANGED, and why it matters: the previous mark was a flat fill, and on
 * the Intro it was drawn in `artInk` on an `artwork` tile. Both of those tokens
 * inverted in this direction — the tile became a dark well and the ink dropped
 * to 22% white — so the mark went from being the brightest thing on the screen
 * to being nearly invisible against it. The design's answer is not a brighter
 * tile but no tile at all: the gradient carries the mark on its own.
 *
 * ONE RULE, and it is what keeps the mark from drifting: every dimension is a
 * ratio of `size`. Nothing here is a magic number that needs re-tuning when the
 * mark is drawn bigger or smaller.
 */

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';

import { Fonts, Radii, tracking } from '@/lib/theme';
import { useColors, useTheme } from '@/lib/theme-context';

/**
 * Ratios from the 62px Intro mark: 12px dot, 4px gap, 3px baseline lift, and an
 * 18px glow around the dot.
 */
const DOT = 12 / 62;
const GAP = 4 / 62;
const LIFT = 3 / 62;
const GLOW = 18 / 62;

/**
 * How wide `aux` is, as a multiple of font size.
 *
 * MEASURED in the running app against the actual bundled Archivo_800ExtraBold
 * at -0.05em, not estimated: 1.7071 including the trailing letter-space that
 * CSS adds after the final glyph, so 1.6571 of that is ink. The gradient has to
 * be painted into a box of a known width, and guessing this wrong either clips
 * the x or leaves a gap before the dot.
 */
const INK_WIDTH = 1.6571;

/**
 * The mark's own gradient, per theme — brand constants rather than palette
 * semantics, which is why they are here and not in `theme.ts`.
 *
 * Note the light one is not a re-tint of the dark one: it runs cool-to-warm
 * where the dark runs warm-to-cool, so the mark ends on the accent in both.
 */
const INK: Record<'dark' | 'light', { color: string; at: number }[]> = {
  dark: [
    { color: '#ffc0aa', at: 0 },
    { color: '#ff7a54', at: 0.32 },
    { color: '#9ab4ff', at: 1 },
  ],
  light: [
    { color: '#1b3fa8', at: 0 },
    { color: '#3b6de8', at: 0.38 },
    { color: '#c0341a', at: 1 },
  ],
};

/**
 * The design's 100deg, converted once.
 *
 * CSS measures gradient angles clockwise from straight up; SVG wants two points.
 * 100deg is (sin100, -cos100) = (0.985, 0.174) — essentially left-to-right with
 * a slight downward lean.
 */
const ANGLE = { x1: '0', y1: '0', x2: '0.985', y2: '0.174' };

export type WordmarkProps = {
  /** Cap size of the lettering. Everything else derives from it. */
  size?: number;
  /**
   * Override the ink with a FLAT colour, dropping the gradient.
   *
   * For the places a gradient cannot go: a single-colour print, a notification
   * glyph, or a mark drawn on top of an accent fill where the gradient's cool
   * end would disappear into the ground.
   */
  color?: string;
  /** Draw the dot in the ink colour too, for genuinely monochrome contexts. */
  mono?: boolean;
  /** The one-letter form. Three letters below ~20px lose the dot's floor. */
  monogram?: boolean;
};

export function Wordmark({ size = 64, color, mono = false, monogram = false }: WordmarkProps) {
  const C = useColors();
  const { scheme } = useTheme();

  const text = monogram ? 'a' : 'aux';
  const dot = Math.round(size * DOT);

  /**
   * The monogram is one glyph of the three, so it cannot use the measured
   * width. `a` is very close to a third of the full mark plus its two lost
   * gaps; this is deliberately a little generous rather than a little tight,
   * because over-wide leaves air and under-wide clips the letter.
   */
  const width = Math.ceil(size * (monogram ? 0.62 : INK_WIDTH));
  const height = Math.ceil(size * 1.1);

  const stops = useMemo(() => INK[scheme] ?? INK.dark, [scheme]);
  const id = `auxWordmark-${scheme}-${monogram ? 'm' : 'f'}`;

  return (
    <View accessibilityRole="image" accessibilityLabel="aux" style={styles.row}>
      {color ? (
        // The flat path stays plain RN Text: no gradient means no reason to pay
        // for an SVG, and Text is what every other label in the app uses.
        <Text
          style={{
            fontFamily: Fonts.extrabold,
            fontSize: size,
            lineHeight: size * 0.8,
            letterSpacing: tracking(size, -0.05),
            color,
          }}>
          {text}
        </Text>
      ) : (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id={id} x1={ANGLE.x1} y1={ANGLE.y1} x2={ANGLE.x2} y2={ANGLE.y2}>
              {stops.map((s) => (
                <Stop key={s.at} offset={s.at} stopColor={s.color} />
              ))}
            </LinearGradient>
          </Defs>
          <SvgText
            x={0}
            // Sits the glyphs on a baseline at 0.82 of the box, which is where
            // Archivo's cap height lands. `alignmentBaseline` is not dependable
            // across the three platforms this ships to, so the baseline is
            // placed explicitly instead.
            y={size * 0.82}
            fontFamily={Fonts.extrabold}
            fontSize={size}
            fontWeight="800"
            letterSpacing={tracking(size, -0.05)}
            fill={`url(#${id})`}>
            {text}
          </SvgText>
        </Svg>
      )}

      <View
        style={{
          width: dot,
          height: dot,
          borderRadius: Radii.pill,
          backgroundColor: mono ? (color ?? C.ink) : C.logoDot,
          marginLeft: Math.round(size * GAP),
          marginBottom: Math.round(size * LIFT),
          // The dot glows. It is the one lit thing in the mark, and without it
          // the full stop reads as a stray bullet rather than as punctuation
          // with weight.
          boxShadow: mono
            ? undefined
            : [{ offsetX: 0, offsetY: 0, blurRadius: size * GLOW, color: C.liveMid }],
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
