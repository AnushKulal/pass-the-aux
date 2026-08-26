/**
 * How things arrive.
 *
 * The design animates content IN — each card lifting a few pixels and fading up,
 * one after another — rather than cross-fading a whole screen as a single block.
 * The app was doing the latter: `animation: 'fade'` on the navigator, which
 * dissolves the old screen into the new one and gives every card on it exactly
 * the same arrival at exactly the same moment. That is the "some easy fade" the
 * user asked to be rid of.
 *
 * Built from the design's own keyframes (aux-nocturne.dc.html L21-26):
 *   auxIn   from { opacity: 0; translateY(10px) }   - a module arriving
 *   auxRow  from { opacity: 0; translateY(8px)  }   - one row inside it
 * both on cubic-bezier(.2,.85,.2,1), which is a decelerate curve: fast off the
 * mark, settling slowly. That asymmetry is most of why it reads as things
 * ARRIVING rather than merely appearing.
 *
 * WHY THIS KEYS OFF FOCUS AND NOT MOUNT, which is the whole reason a naive
 * version of this does not work here: a tab navigator keeps its screens mounted.
 * Switch to Explore and back to the Feed and the Feed never unmounted, so a
 * mount-driven entrance plays exactly once per app launch and never again — the
 * animation would be missing from every module switch after the first, which is
 * precisely when it is being asked for. Driving it from `useIsFocused` means it
 * replays whenever a screen is actually entered.
 */

import { useIsFocused } from 'expo-router';
import { useEffect, useRef } from 'react';
import {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';
import type { ViewStyle } from 'react-native';

import { Duration, Stagger } from '@/lib/theme';

/** The design's curve, once. cubic-bezier(.2,.85,.2,1). */
const CURVE = Easing.bezier(0.2, 0.85, 0.2, 1);

/** `auxIn` lifts a module 10px; `auxRow` lifts one row 8px. */
const LIFT = { module: 10, row: 8 } as const;

/**
 * The stagger is CAPPED, not run to the end of the list.
 *
 * A row at index 40 would otherwise wait 2.2 seconds to appear, and it is
 * offscreen anyway — the stagger is only ever perceived across the first
 * screenful. Past the cap every remaining row shares the last step, so a long
 * list finishes arriving instead of trickling.
 */
const MAX_STEPS = 8;

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
 * A fade-and-lift entrance that replays every time its screen is entered.
 *
 * Returns a style to spread onto an `Animated.View`. Deliberately NOT a
 * Reanimated layout animation (`entering={FadeIn}`): those mark the view
 * `visibility: hidden` until the animation runs, and on react-native-web it
 * never runs, which leaves content that reports correct colour, size and layout
 * while being completely invisible. This app has shipped that bug twice. An
 * effect always runs, so a shared value driven from one cannot fail that way.
 */
export function useEntrance({
  index = 0,
  kind = 'row',
  step = Stagger.feed,
}: EntranceOptions = {}): AnimatedStyle<ViewStyle> {
  const focused = useIsFocused();
  const reduced = useReducedMotion();
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
      // Reset rather than animate out. Leaving the screen is not something the
      // user watches, and holding the value at 1 would mean the next entrance
      // has nothing to travel from.
      progress.value = 0;
      return;
    }
    progress.value = withDelay(
      delay.current,
      withTiming(1, { duration: kind === 'module' ? Duration.enter : Duration.row, easing: CURVE }),
    );
  }, [focused, reduced, kind, progress]);

  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * LIFT[kind] }],
  }));
}

/**
 * The sheet arrival: straight up from the bottom edge, no cross-fade.
 *
 * The design's `auxSheetIn` is `translateY(100%) -> none` and NOTHING ELSE. The
 * update prompt was animating opacity alongside the travel, and that is why it
 * read as a fade that happened to move rather than as a sheet sliding up: a
 * surface that is see-through for the whole of its journey has no edge to
 * follow, so the eye tracks the brightness rather than the motion.
 *
 * `travel` is the distance in px — pass a value comfortably taller than the
 * sheet, since a sheet still partly on screen at rest is worse than one that
 * starts a little further away.
 */
export function useSheetSlide(visible: boolean, travel: number): AnimatedStyle<ViewStyle> {
  const reduced = useReducedMotion();
  const y = useSharedValue(travel);

  useEffect(() => {
    if (reduced) {
      y.value = visible ? 0 : travel;
      return;
    }
    y.value = withTiming(visible ? 0 : travel, {
      // Out faster than in, so dismissing reads as a dismissal rather than as a
      // second presentation played backwards.
      duration: visible ? Duration.sheet : Duration.press,
      easing: CURVE,
    });
  }, [visible, reduced, travel, y]);

  return useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
}
