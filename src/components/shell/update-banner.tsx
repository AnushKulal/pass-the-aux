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
 * NO ACCENT HERE, deliberately. Red means live / playing / joinable / in sync /
 * on aux in this design, and a pending update is none of those. It earns weight
 * from the 2px rule and ink contrast instead.
 */

import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp, useReducedMotion } from 'react-native-reanimated';

import { Duration, Rule, Space, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';
import { useUpdates } from '@/lib/updates';

export function UpdateBanner() {
  const C = useColors();
  const reduced = useReducedMotion();
  const { isAvailable, pending } = useUpdates();

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
      entering={reduced ? undefined : FadeInUp.duration(Duration.enter)}
      style={[styles.wrap, { backgroundColor: C.surface, borderBottomColor: C.rule2 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Update available. ${fixes > 0 ? `${fixes} fixes waiting. ` : ''}Opens Settings.`}
        onPress={() => router.push('/settings')}
        style={({ pressed }) => [styles.press, pressed && { opacity: 0.6 }]}>
        {/*
          A filled square, not a dot: the grid in this direction is built from
          rules and rectangles, and a circle would be the only round thing on
          the screen.
        */}
        <View style={[styles.mark, { backgroundColor: C.ink2 }]} />
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
  },
  label: {
    ...Type.label(10),
    letterSpacing: tracking(10, 0.1),
    flex: 1,
  },
});
