/**
 * A Session row inside a lounge.
 *
 * Patchbay, README §8: a 64px artwork well, a pulsing dot beside the Session
 * name, `track — artist`, the `ON AUX` / listening readouts, and an `IN` cell
 * cut off by a hairline. No card, no radius, no shadow — the row's edges are
 * the 1px rules around it.
 *
 * The accent is earned here: a Session row only exists for a room you can walk
 * into right now.
 */

import { memo, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Rule, Space, Type } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

export type SessionCardProps = {
  name: string;
  hostName: string;
  listeners: number;
  isPlaying: boolean;
  nowPlaying: { title: string; artist: string } | null;
  onPress: () => void;
};

const WELL = 64;
const IN_CELL = 56;
const DOT = 6;

/** Slow on purpose: an ambient "this is live" beat, not a micro-interaction. */
const PULSE_MS = 1_600;

function glyphFor(value: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : '·';
}

/**
 * The live dot. A square, because there is no radius in this direction, and
 * flat under reduced motion rather than removed — it still carries meaning.
 */
function PulseDot({ color }: { color: string }) {
  const reduced = useReducedMotion();
  const wave = useSharedValue(1);

  useEffect(() => {
    if (reduced) {
      wave.value = 1;
      return;
    }
    wave.value = withRepeat(
      withTiming(0.25, { duration: PULSE_MS / 2, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
    return () => cancelAnimation(wave);
  }, [reduced, wave]);

  const style = useAnimatedStyle(() => ({ opacity: wave.value }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.dot, { backgroundColor: color }, style]}
    />
  );
}

function SessionCardBase({
  name,
  hostName,
  listeners,
  isPlaying,
  nowPlaying,
  onPress,
}: SessionCardProps) {
  const C = useColors();

  const subtitle = nowPlaying
    ? `${nowPlaying.title} — ${nowPlaying.artist}`
    : `${hostName} is on aux`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}. ${subtitle}. ${listeners} listening.`}
      accessibilityHint="Opens this Session"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: C.rule, backgroundColor: pressed ? C.surface : 'transparent' },
      ]}>
      <View style={[styles.well, { borderRightColor: C.rule, backgroundColor: C.bgRecessed }]}>
        <Text style={[styles.wellGlyph, { color: C.artwork }]}>
          {glyphFor(nowPlaying?.title ?? name)}
        </Text>
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          {isPlaying ? <PulseDot color={C.live} /> : null}
          <Text numberOfLines={1} style={[styles.name, { color: C.ink }]}>
            {name}
          </Text>
        </View>

        <Text numberOfLines={1} style={[styles.subtitle, { color: C.ink }]}>
          {subtitle}
        </Text>

        <View style={styles.meta}>
          {nowPlaying ? (
            <Text numberOfLines={1} style={[styles.metaLabel, { color: C.ink3 }]}>
              {`${hostName} on aux`}
            </Text>
          ) : null}

          {/* A head count measures, so it sets as a readout. Accent only while
              there is somebody in there to be in sync with. */}
          <Text style={[styles.listeners, { color: listeners > 0 ? C.liveText : C.ink3 }]}>
            {`${listeners} LISTENING`}
          </Text>
        </View>
      </View>

      <View style={[styles.inCell, { borderLeftColor: C.rule }]}>
        <Text style={[styles.inLabel, { color: C.liveText }]}>IN</Text>
      </View>
    </Pressable>
  );
}

export const SessionCard = memo(SessionCardBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    minHeight: 76,
    borderBottomWidth: Rule.hair,
  },

  well: {
    width: WELL,
    borderRightWidth: Rule.hair,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  wellGlyph: {
    ...Type.display(26),
    lineHeight: 30,
  },

  body: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 12,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: DOT,
    height: DOT,
  },
  name: {
    ...Type.heading(13),
    letterSpacing: 13 * 0.05,
    flexShrink: 1,
  },
  subtitle: {
    ...Type.body(13),
    lineHeight: 18,
    marginTop: 5,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Space.sm,
    marginTop: 5,
  },
  metaLabel: {
    ...Type.label(10),
    letterSpacing: 10 * 0.09,
    flexShrink: 1,
  },
  listeners: {
    ...Type.label(10),
    letterSpacing: 10 * 0.09,
  },

  inCell: {
    width: IN_CELL,
    borderLeftWidth: Rule.hair,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  inLabel: {
    ...Type.heading(11),
    letterSpacing: 11 * 0.08,
  },
});
