/**
 * The stale-version strip.
 *
 * A thin bar across the top of the screen column, present for as long as an
 * update is waiting. It is the standing reminder that the sheet is not: the
 * sheet asks once and can be waved away, this stays until the update is
 * actually applied.
 *
 * Tapping goes to Settings rather than applying in place. Applying restarts the
 * app, and a 30px strip is too easy to hit by accident to be allowed to do
 * that — Settings shows what is in the update and asks properly.
 *
 * NO ACCENT HERE, deliberately, and the reasoning survived the direction change
 * intact even though the palette did not. There are two accents now: coral for
 * state and blue for action. A pending update is not a state of the world, so
 * coral would lie about it; and this strip is a standing reminder rather than
 * the thing you act on, so spending blue here would put it in competition with
 * the actual buttons. It earns weight from the rule and ink contrast instead.
 *
 * ## IT HAS TO READ AS CHROME, AND PAYING THE STATUS BAR MADE THAT HARDER
 *
 * The strip used to draw under the clock; it now pays `insets.top`, which is
 * correct and which also roughly TRIPLED the tinted band at the top of the
 * screen. A 5.5% slab that deep, capped by a 2px rule, stopped reading as part
 * of the frame and started reading as a notification that had been dropped on
 * top of the app. Three things pull it back, and none of them is the fill:
 *
 *   THE RULE IS A HAIRLINE. `Rule.major` is the design's weight for separating
 *   major SECTIONS of content; chrome is edged with a hairline everywhere else
 *   in this app. It keeps `rule2` — the brighter hairline — so the strip does
 *   not lose its edge along with its weight.
 *
 *   IT SAYS LESS. "5 FIXES WAITING · TAP TO INSTALL" is a sentence, and a
 *   sentence in caps across the full width is a marquee. "Update ready · 5
 *   fixes" is a label, which is what chrome writes. The instruction was also
 *   untrue: this strip does not install anything, it opens Settings.
 *
 *   THE AFFORDANCE IS A GLYPH. A chevron is how every other row in this app
 *   says "this leads somewhere", and it costs three words to say it in type.
 */

import { router } from 'expo-router';
import { useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight } from 'lucide-react-native';
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

/** Small enough to sit inside a 30px strip without becoming a second mark. */
const CHEVRON = 14;

export function UpdateBanner() {
  const C = useColors();
  const reduced = useReducedMotion();
  const { isAvailable, pending } = useUpdates();
  const insets = useSafeAreaInsets();

  /*
    Driven by a shared value from an effect, NOT `entering={FadeInUp…}`.
    Reanimated marks an entering view `visibility: hidden` until its animation
    runs, and on react-native-web it never runs — the strip would occupy its
    30px and stay blank. Gated on `isAvailable` so the slide still plays at the
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
  // than merely nagging. A manifest without notes still gets the announcement.
  // `Type.label` sets this in caps, so the string itself stays readable.
  const detail =
    fixes > 0
      ? `Update ready · ${fixes} ${fixes === 1 ? 'fix' : 'fixes'}`
      : 'Update ready';

  /*
    Spelled out separately rather than read off `detail`, for two reasons: the
    middot is punctuation a screen reader has no good reading for, and the
    destination has to be named — this strip does not install, it navigates.
    It also fixes a plural: the label this replaces said "1 fixes waiting".
  */
  const spoken =
    fixes > 0
      ? `Update ready. ${fixes} ${fixes === 1 ? 'fix' : 'fixes'} waiting. Opens Settings.`
      : 'Update ready. Opens Settings.';

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          backgroundColor: C.surface,
          borderBottomColor: C.rule2,
          /*
            The strip is the FIRST thing in the shell, above the navigator, and
            the shell is not inside a SafeAreaView — so without this it drew
            beneath the status bar and its label sat behind the clock and the
            signal icons. It is chrome pinned to the top edge, so it has to pay
            the top inset itself.
          */
          paddingTop: insets.top,
        },
        enterStyle,
      ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={spoken}
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
        <ChevronRight size={CHEVRON} strokeWidth={2} color={C.ink3} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    /*
      A HAIRLINE, where this was `Rule.major`. See the header: 2px is the weight
      the design reserves for separating major sections of CONTENT, and chrome
      is hairlined everywhere else in this app. The brighter `rule2` colour is
      what keeps the edge legible at one pixel.
    */
    borderBottomWidth: Rule.hair,
  },
  press: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    /*
      The screen gutter and the screen column, both borrowed from
      `@/components/ui/screen`: the strip's FILL stays full-bleed because chrome
      pinned to an edge always does, but what is written on it lines up with the
      content underneath. Without the cap, a desktop react-native-web window
      strands the chevron a thousand pixels from the label it belongs to.
    */
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: Space.lg + 2,
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
