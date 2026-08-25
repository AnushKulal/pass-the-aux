/**
 * The stale-version strip.
 *
 * A thin bar across the top of the screen column, present for as long as an
 * update is waiting. It is the standing reminder that the sheet is not: the
 * sheet asks once and can be waved away, this stays until the update is
 * actually applied.
 *
 * Tapping goes to Settings rather than applying in place. Applying restarts the
 * app, and a 28px strip is too easy to hit by accident to be allowed to do
 * that — Settings shows what is in the update and asks properly.
 *
 * NO ACCENT HERE, deliberately, and the reasoning survived the direction change
 * intact even though the palette did not. There are two accents now: coral for
 * state and blue for action. A pending update is not a state of the world, so
 * coral would lie about it; and this strip is a standing reminder rather than
 * the thing you act on, so spending blue here would put it in competition with
 * the actual buttons. It earns weight from the rule and ink contrast instead.
 */

import { router } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Duration, Radii, Rule, Space, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';
import { useUpdates } from '@/lib/updates';

export function UpdateBanner() {
  const C = useColors();
  const reduced = useReducedMotion();
  const { isAvailable, pending } = useUpdates();

  /*
    Driven by a shared value from an effect, NOT `entering={FadeInUp…}`.
    Reanimated marks an entering view `visibility: hidden` until its animation
    runs, and on react-native-web it never runs — the strip would occupy its
    28px and stay blank. Gated on `isAvailable` so the slide still plays at the
    moment the update actually lands, not on the mount that renders nothing.

    Above the early return: hooks cannot run conditionally.
  */
  const enter = useSharedValue(0);

  useEffect(() => {
    if (!isAvailable) return;
    enter.value = reduced ? 1 : withTiming(1, { duration: Duration.enter });
  }, [isAvailable, reduced, enter]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * -6 }],
  }));

  if (!isAvailable) return null;

  const fixes = pending.notes.length + pending.hidden;

  // Say how much is waiting when we know, so the strip is informative rather
  // than merely nagging. A manifest without notes still gets the prompt to act.
  const detail =
    fixes > 0
      ? `${fixes} ${fixes === 1 ? 'FIX' : 'FIXES'} WAITING · TAP TO INSTALL`
      : 'TAP TO INSTALL';

  return (
    <Animated.View
      style={[styles.wrap, { backgroundColor: C.surface, borderBottomColor: C.rule2 }, enterStyle]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Update available. ${fixes > 0 ? `${fixes} fixes waiting. ` : ''}Opens Settings.`}
        onPress={() => router.push('/settings')}
        style={({ pressed }) => [styles.press, pressed && { opacity: 0.6 }]}>
        {/*
          A DOT, and it used to be a square.
          The square was justified by the old direction being built from rules
          and rectangles, where a circle would have been the only round thing on
          screen. That is no longer remotely true — the navigation is a capsule,
          every button is a pill, and every card is generously rounded — so the
          square would now be the odd one out for exactly the same reason.
        */}
        {/* `ink`, not `ink2`: this is the mark, not the sentence beside it, and
            it is the same token the Settings row's dot uses. Those two comments
            claimed to agree and did not — one was on `ink`, one on `ink2`. */}
        <View style={[styles.mark, { backgroundColor: C.ink }]} />
        <Text numberOfLines={1} style={[styles.label, { color: C.ink2 }]}>
          {detail}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: Rule.major,
  },
  press: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    paddingHorizontal: Space.md,
    // Short enough to read as chrome rather than content, tall enough to hit.
    minHeight: 30,
  },
  mark: {
    width: 6,
    height: 6,
    borderRadius: Radii.pill,
  },
  label: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.1),
    flex: 1,
  },
});
