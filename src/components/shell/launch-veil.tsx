/**
 * The hand-off from the splash to the app.
 *
 * The native splash is a still image that vanishes. Everything after it —
 * every card, every row — now arrives on a spring, so the one moment the app
 * has nothing to say for itself is the moment it opens: a picture disappears
 * and a screen is suddenly there. That cut is the last flat thing left.
 *
 * So this holds the splash's own composition for a beat and then gets out of
 * the way by moving TOWARD the viewer — the mark scales up and fades as the
 * app comes through underneath it. The reference the user gave for the feeling
 * is Netflix's opening, and the reason that reads as expensive is not the zoom
 * itself: it is that the thing you were looking at becomes the thing you are
 * looking through, so there is no cut at all.
 *
 * IT IS THE SAME MARK AND THE SAME GROUND AS THE NATIVE SPLASH, drawn in JS.
 * `assets/images/splash-icon*.png` and this component are cut from one design,
 * so the swap from the OS image to this one is invisible and the animation
 * appears to start on the thing that was already there. If they ever diverge
 * the hand-off becomes a visible pop — which is the failure this exists to
 * remove.
 *
 * It NEVER blocks input: `pointerEvents` is none for its whole life and it
 * unmounts the moment it finishes. A full-bleed overlay that hit-tests has
 * already eaten every tap in the bottom quarter of this app once.
 */

import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';

import { Wordmark } from '@/components/shell/wordmark';
import { useColors } from '@/lib/theme-context';

/** The mark, at the splash's own size. */
const LOGO = 62;

/**
 * How long the mark holds before it leaves.
 *
 * Long enough to register as the same image the OS was showing, short enough
 * that it is never a wait. Below about 150ms it reads as a flicker; past ~400ms
 * the app feels like it is loading something.
 */
const HOLD = 220;

/** The departure. */
const TRAVEL = 620;

/**
 * How far it comes toward the viewer.
 *
 * 1.35 rather than something dramatic. The mark has to leave the frame feeling
 * like it passed you, not like it was thrown — and because it fades while it
 * grows, most of the scale happens when it is already faint, so a larger number
 * buys blur rather than motion.
 */
const TO_SCALE = 1.35;

export function LaunchVeil() {
  const C = useColors();
  const reduced = useReducedMotion();

  /**
   * Unmounted rather than left at zero opacity.
   *
   * A transparent full-screen view still costs a layer to composite on every
   * frame for the rest of the session, and this one has done its whole job in
   * under a second.
   */
  const [finished, setFinished] = useState(false);

  /*
    DERIVED, not set in an effect. Writing `setDone(true)` from the reduced-
    motion branch is a synchronous setState during an effect, which the React
    Compiler rejects (`react-hooks/set-state-in-effect`) and which would cost a
    second render on the very first frame of the app for no reason. Reduced
    motion is knowable at render time, so it is read at render time.
  */
  const done = reduced || finished;

  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    progress.value = withDelay(
      HOLD,
      withSequence(
        withTiming(
          1,
          {
            duration: TRAVEL,
            // Accelerating OUT, which is the opposite of every other curve in
            // this app. Arrivals decelerate because they are settling into
            // place; this is leaving, and something that speeds up as it goes
            // reads as departing rather than as fading out.
            easing: Easing.in(Easing.cubic),
          },
          (settled) => {
            // `settled`, not `finished` — that name now belongs to the state
            // above, and shadowing it here would read as the flag being set
            // from its own value.
            if (settled) runOnJS(setFinished)(true);
          },
        ),
      ),
    );
  }, [reduced, progress]);

  const veil = useAnimatedStyle(() => ({
    /*
      Opacity runs AHEAD of the scale — squared, so the mark is already half
      gone by the time it is a third of the way out. Fading in step with the
      travel would leave a large pale logo sitting over the app for the back
      half of the animation, which is what makes this kind of transition look
      cheap.
    */
    opacity: 1 - progress.value * progress.value,
    transform: [{ scale: 1 + (TO_SCALE - 1) * progress.value }],
  }));

  if (done) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.root, { backgroundColor: C.bg }, veil]}>
      <Wordmark size={LOGO} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    /*
      Above everything, including the toast layer and the update sheet. For the
      moment it exists it IS the app, and something painting over it would be a
      screen element appearing before the launch has finished.
    */
    zIndex: 100,
  },
});
