import { router } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Duration, Rule, Space, TOUCH_TARGET, Type, tracking } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

/**
 * Reached by a bad deep link — a shared Session URL for a Session that ended, or
 * a lounge invite that was revoked.
 *
 * The one place in the app where the accent is spent on something that is not
 * live: `404` is a hard failure of the cable itself, which is the same
 * vocabulary. Everything else here is mono.
 */
export default function NotFoundScreen() {
  const C = useColors();
  const reduced = useReducedMotion();

  return (
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={[styles.root, { backgroundColor: C.bg }]}>
      <Animated.View
        style={styles.center}
        entering={
          reduced
            ? undefined
            : FadeInDown.duration(Duration.enter).withInitialValues({
                opacity: 0,
                transform: [{ translateY: 8 }],
              })
        }>
        {/* 72px/800 in accent, sitting on its own 2px accent rule. */}
        <Text style={[styles.code, { color: C.live }]}>404</Text>
        <View style={[styles.rule, { backgroundColor: C.live }]} />

        <Text style={[styles.title, { color: C.ink }]}>Dead cable.</Text>
        <Text style={[styles.body, { color: C.ink2 }]}>
          The lounge or Session you followed may have ended, or the invite was revoked.
        </Text>

        {/*
          `replace`, not `back`: the history entry that got us here is itself the
          broken one, so going back would land on it again.
        */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the Feed"
          onPress={() => router.replace('/')}
          style={({ pressed }) => [
            styles.action,
            { borderColor: C.live, backgroundColor: pressed ? C.liveWash : 'transparent' },
          ]}>
          <ArrowLeft size={15} color={C.liveText} strokeWidth={2} />
          <Text style={[styles.actionLabel, { color: C.liveText }]}>BACK TO THE FEED</Text>
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingHorizontal: Space.lg,
    paddingVertical: Space.xxl,
  },
  code: {
    ...Type.display(72),
    // The prototype sets these tighter than the display ramp's own defaults.
    lineHeight: 61,
    letterSpacing: tracking(72, -0.05),
  },
  rule: {
    alignSelf: 'stretch',
    height: Rule.major,
    marginTop: 14,
    marginBottom: Space.lg,
  },
  title: {
    ...Type.display(20),
    letterSpacing: tracking(20, -0.015),
  },
  body: {
    ...Type.body(16),
    marginTop: Space.sm,
    maxWidth: 320,
  },
  /** 46px tall, so it clears the 44px floor with the label optically centred. */
  action: {
    marginTop: Space.xl,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.sm,
    minHeight: 46,
    minWidth: TOUCH_TARGET,
    paddingHorizontal: Space.lg,
    borderWidth: Rule.hair,
  },
  actionLabel: {
    ...Type.heading(11),
    letterSpacing: tracking(11, 0.1),
  },
});
