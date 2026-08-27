/**
 * How things arrive.
 *
 * THIS IS THE SECOND VERSION, AND THE FIRST ONE'S PROBLEM WAS NOT ITS SETTINGS.
 *
 * It animated `opacity` and `translateY` over a fixed duration on a cubic
 * bezier. That is the fade-up every app shipped between about 2015 and 2020,
 * and it is dated for two reasons that no amount of retuning fixes:
 *
 *   IT RUNS A TIMELINE. A duration curve says "be finished in 240ms" no matter
 *   what the element is, how far it travels, or what the finger just did. Real
 *   surfaces do not complete on schedule, they SETTLE, and every current motion
 *   system — iOS since 2013, Material 3 Expressive since 2025 — models that with
 *   springs. A spring has no duration to get wrong; it has weight.
 *
 *   IT MOVES THINGS UP. Sliding a card up the page says it came from somewhere
 *   below the screen. Nothing in this app is below the screen: it is glass
 *   layered over a lit ground, and the honest reading of a card appearing is
 *   that it SURFACED — closer to the viewer, not further up the page. Scale is
 *   the channel that says that; translate is the channel that says "off-screen".
 *
 * So arrivals are now a spring on SCALE first, with a small residual lift kept
 * only because a pure scale with no vertical component reads as a zoom rather
 * than as an object taking its place.
 *
 * WHAT DID NOT CHANGE, because it was right: the stagger, its cap, and the fact
 * that all of this keys off FOCUS rather than mount. A tab navigator keeps its
 * screens alive, so a mount-driven entrance plays once per app launch and is
 * silent on every module switch after — which is exactly when it is wanted.
 */

import { useIsFocused } from 'expo-router';
import { useEffect, useRef } from 'react';
import {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type AnimatedStyle,
  type WithSpringConfig,
} from 'react-native-reanimated';
import type { ViewStyle } from 'react-native';

import { useMotionMode } from '@/lib/motion';
import { Stagger } from '@/lib/theme';

/**
 * The house spring.
 *
 * Tuned to settle in roughly 380ms with NO visible overshoot. Damping is high
 * on purpose: a springy bounce is the other way this kind of motion dates
 * itself, and an interface that wobbles reads as a toy. What the spring buys
 * here is not bounce, it is the asymmetry — fast to most of the way, then a
 * long quiet approach — which is what makes an element look like it has weight
 * rather than like it is following instructions.
 */
export const ARRIVE: WithSpringConfig = {
  // Stated as intent rather than as physics constants. Reanimated 4 accepts
  // `{duration, dampingRatio}` as an alternative to `{stiffness, damping}`, and
  // it is the honest way to write this down: 380ms perceptual, damped just shy
  // of critical so there is life in the approach and no visible bounce.
  duration: 380,
  dampingRatio: 0.92,
  mass: 0.9,
  overshootClamping: false,
};

/**
 * A firmer one for things that must not look loose: a sheet, a mark sliding
 * between two positions. Same family, less travel time.
 */
export const SETTLE: WithSpringConfig = {
  // Critically damped: reaches its position and stops dead. A sheet that
  // overshoots looks like it was thrown rather than placed.
  duration: 300,
  dampingRatio: 1,
  mass: 0.8,
  overshootClamping: false,
};

/**
 * How far under its resting size an element starts.
 *
 * Small numbers on purpose. At 0.9 this looks like a zoom and draws attention
 * to itself; at 0.97 it is not consciously visible and reads only as the
 * element having settled rather than appeared. A module gets marginally more
 * because it is a whole screen and can carry it.
 */
const FROM_SCALE = { module: 0.965, row: 0.98 } as const;

/** The residual lift. Enough to have a direction, not enough to be a slide. */
const LIFT = { module: 6, row: 4 } as const;

/**
 * The stagger is CAPPED, not run to the end of the list.
 *
 * A row at index 40 would otherwise wait 2.2 seconds to appear, and it is
 * offscreen anyway — the stagger is only ever perceived across the first
 * screenful. Past the cap every remaining row shares the last step, so a long
 * list finishes arriving instead of trickling.
 */
const MAX_STEPS = 8;

/* ------------------------------------------------------------------ classic */

/**
 * THE PREVIOUS SYSTEM, KEPT WHOLE AND STILL REACHABLE.
 *
 * Selected in Settings > Appearance via `@/lib/motion`. It is not an
 * approximation of what used to be here — it is the same numbers and the same
 * curve, so switching back genuinely returns the app to how it behaved rather
 * than to something that resembles it.
 *
 * A fixed duration on the design's cubic-bezier(.2,.85,.2,1), opacity and an
 * upward translate, no scale.
 */
const CLASSIC_CURVE = Easing.bezier(0.2, 0.85, 0.2, 1);
const CLASSIC_DURATION = { module: 280, row: 240 } as const;
const CLASSIC_LIFT = { module: 10, row: 8 } as const;

export type EntranceKind = keyof typeof LIFT;

export type EntranceOptions = {
  /** Position in a list. Drives the stagger; omit for a single element. */
  index?: number;
  /** `row` for an item in a list, `module` for a screen's own content. */
  kind?: EntranceKind;
  /** ms per step. Defaults to the Feed's 55. */
  step?: number;
};

/**
 * A spring-settled entrance that replays every time its screen is entered.
 *
 * Returns a style to spread onto an `Animated.View`. Deliberately NOT a
 * Reanimated layout animation (`entering={FadeIn}`): those mark the view
 * `visibility: hidden` until the animation runs, and on react-native-web it
 * never runs, which leaves content that reports correct colour, size and layout
 * while being completely invisible. This app has shipped that bug twice.
 */
export function useEntrance({
  index = 0,
  kind = 'row',
  step = Stagger.feed,
}: EntranceOptions = {}): AnimatedStyle<ViewStyle> {
  const focused = useIsFocused();
  const reduced = useReducedMotion();
  const mode = useMotionMode();
  const progress = useSharedValue(0);

  /**
   * Read once and held. `index` is a render-time value and lists reorder — the
   * Feed reshuffles the moment presence changes — so recomputing the delay would
   * restart the entrance of a row that is already sitting still on screen.
   */
  const delay = useRef(Math.min(Math.max(index, 0), MAX_STEPS) * step);

  useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    if (!focused) {
      /*
        Reset INSTANTLY rather than springing back. Leaving a screen is not
        something anyone watches, and a spring running backwards on a screen
        that is already gone is work the UI thread does for nobody.
      */
      progress.value = 0;
      return;
    }
    progress.value = withDelay(
      delay.current,
      mode === 'classic'
        ? withTiming(1, { duration: CLASSIC_DURATION[kind], easing: CLASSIC_CURVE })
        : withSpring(1, ARRIVE),
    );
  }, [focused, reduced, mode, kind, progress]);

  /*
    Two shapes, one hook. Classic gets the bigger lift and NO scale, because
    scale is the thing the new system added — a "revert" that kept it would be
    the new motion wearing the old timing.
  */
  const classic = mode === 'classic';

  return useAnimatedStyle(() => {
    const p = progress.value;
    if (classic) {
      return {
        opacity: p,
        transform: [{ translateY: (1 - p) * CLASSIC_LIFT[kind] }],
      };
    }
    return {
      opacity: p,
      transform: [
        { translateY: (1 - p) * LIFT[kind] },
        { scale: FROM_SCALE[kind] + (1 - FROM_SCALE[kind]) * p },
      ],
    };
  });
}

/**
 * The sheet arrival: straight up from the bottom edge, no cross-fade.
 *
 * The design's `auxSheetIn` is `translateY(100%) -> none` and NOTHING ELSE. An
 * earlier version animated opacity alongside the travel, and that is why it read
 * as a fade that happened to move rather than as a sheet sliding up: a surface
 * that is see-through for the whole of its journey has no edge to follow, so the
 * eye tracks the brightness rather than the motion.
 *
 * ON A SPRING NOW, and this is where a spring earns the most. A sheet is heavy —
 * it is the largest thing that moves in the app — and a duration curve gives a
 * heavy object the same timing as a light one. The spring makes it arrive fast
 * and then take a moment to settle, which is the whole difference between a
 * panel appearing and a panel being thrown into place.
 *
 * `travel` is the distance in px — pass a value comfortably taller than the
 * sheet, since a sheet still partly on screen at rest is worse than one that
 * starts a little further away.
 */
export function useSheetSlide(visible: boolean, travel: number): AnimatedStyle<ViewStyle> {
  const reduced = useReducedMotion();
  const mode = useMotionMode();
  const y = useSharedValue(travel);

  useEffect(() => {
    if (reduced) {
      y.value = visible ? 0 : travel;
      return;
    }
    if (!visible) {
      // OUT ON A TIMING CURVE in both systems, deliberately not a spring.
      // Dismissing should feel decided and finish; a spring settling toward an
      // off-screen position spends its most expressive phase where nobody can
      // see it.
      y.value = withTiming(travel, { duration: 200 });
      return;
    }
    y.value =
      mode === 'classic'
        ? withTiming(0, { duration: 300, easing: CLASSIC_CURVE })
        : withSpring(0, SETTLE);
  }, [visible, reduced, mode, travel, y]);

  return useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
}
