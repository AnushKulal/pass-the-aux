/**
 * The dot that means "right now".
 *
 * From design/nocturne/aux-nocturne.dc.html: the `auxpulse` keyframe at L15
 * (`opacity 1 → .3 → 1`) driving the dots at L445, L955, L1051 and L1513.
 *
 * TWO CHANGES FROM THE PATCHBAY MARK, AND BOTH ARE THE DIRECTION SPEAKING:
 *
 * 1. It is a CIRCLE with a coral glow, not a square with an expanding ghost
 *    behind it. The old halo needed a box 2.6x the dot to expand into, which
 *    silently reserved 16px of row for a 6px mark; this reserves exactly the
 *    dot. Callers relying on that phantom padding will tighten by a few pixels.
 * 2. THE TEMPO CARRIES MEANING. The artboards run four different periods and
 *    they are not decorative — a 1s beat is a recording in progress, 2s is a
 *    LIVE badge on a lounge card. Passing the wrong one is a lie about what the
 *    screen is doing, which is why this is a named union and not a number.
 *
 * Always coral. A pulse is state, and state is never blue in this direction.
 * Purely decorative to a screen reader: whatever it sits beside — a LIVE badge,
 * a "recording" label — already carries the meaning in text, and announcing it
 * twice reads as two separate things being true.
 */

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useColors } from '@/lib/theme-context';
import { Radii } from '@/lib/theme';

/**
 * The four periods in the artboards, in ms, named for what each one claims.
 *
 * `recording` L1513 · `synced` L955 · `session` L445 · `badge` L1051.
 * Fastest reads as most urgent, which is the ordering here.
 */
export type LivePulseTempo = 'recording' | 'synced' | 'session' | 'badge';

const PERIOD: Record<LivePulseTempo, number> = {
  recording: 1000,
  synced: 1600,
  session: 1800,
  badge: 2000,
};

/** The trough of the CSS keyframe. The dot never disappears, it dims. */
const DIM = 0.3;

export type LivePulseProps = {
  size?: number;
  /** Escape hatch for a mark that is not coral. Almost nothing should be. */
  color?: string;
  tempo?: LivePulseTempo;
};

export function LivePulse({ size = 8, color, tempo = 'badge' }: LivePulseProps) {
  const C = useColors();
  const reduced = useReducedMotion();
  const beat = useSharedValue(1);
  const paint = color ?? C.live;

  useEffect(() => {
    if (reduced) {
      beat.value = 1;
      return;
    }
    /*
      Half the period per leg, reversed — `withRepeat(…, -1, true)` plays the
      timing forwards then backwards, so one full cycle is two legs and matches
      the CSS keyframe's 0/50/100 stops exactly.
    */
    beat.value = withRepeat(withTiming(DIM, { duration: PERIOD[tempo] / 2 }), -1, true);
    return () => cancelAnimation(beat);
  }, [reduced, tempo, beat]);

  const pulse = useAnimatedStyle(() => ({ opacity: beat.value }));

  /*
    `0 0 10px` on a 7px dot, `0 0 14px` on a 13px one — the glow is roughly 1.4x
    the diameter throughout, and it is what stops a 7px mark from disappearing
    against the ground. Zero offset on purpose: this is light coming off the
    dot, not the dot casting onto something.
  */
  const glow = { boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: size * 1.4, color: paint }] };

  const box = { width: size, height: size, borderRadius: Radii.pill, backgroundColor: paint };

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.root}>
      {reduced ? (
        <View style={[box, glow]} />
      ) : (
        <Animated.View style={[box, glow, pulse]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
