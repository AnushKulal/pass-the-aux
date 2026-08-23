/**
 * The first screen.
 *
 * One screen, not a carousel. The previous version walked through four pitch
 * pages before letting anyone in; this states the idea once and offers the door.
 *
 * Shown ONCE. A flag in AsyncStorage means a returning user is forwarded
 * straight to sign-in and never sees it again — which is why nothing here is
 * load-bearing for understanding the app.
 *
 * Built from design/v2/aux-v2.dc.html, screen "Intro".
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  dropped,
  Duration,
  Fonts,
  Radii,
  Space,
  TOUCH_TARGET,
  tracking,
  Type,
} from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const SEEN_KEY = 'aux:intro-seen';

/** The mark. Square, generously rounded, and the brightest thing on the screen. */
const LOGO = 172;

export default function IntroScreen() {
  const C = useColors();
  const reduced = useReducedMotion();

  /**
   * Three states, not two. Rendering the intro while the stored flag is still
   * being read would flash it at every returning user for one frame.
   */
  const [status, setStatus] = useState<'checking' | 'show'>('checking');

  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(SEEN_KEY)
      .then((seen) => {
        if (cancelled) return;
        if (seen) router.replace('/(auth)/sign-in');
        else setStatus('show');
      })
      .catch(() => {
        // A failed read is indistinguishable from a fresh install, and showing
        // the intro once more is a far better failure than locking someone out.
        if (!cancelled) setStatus('show');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const leave = useCallback(() => {
    void AsyncStorage.setItem(SEEN_KEY, '1').catch(() => undefined);
    router.replace('/(auth)/sign-in');
  }, []);

  /**
   * The entrance, driven by a shared value rather than a layout animation.
   *
   * `entering={FadeIn}` was the obvious way to write this and it is WRONG here:
   * Reanimated marks the view `visibility: hidden` until the entering animation
   * runs, and on react-native-web that animation never fired — leaving the
   * headline and the logo permanently invisible while reporting correct colour,
   * size and layout. A shared value driven from an effect cannot fail that way,
   * because the effect always runs.
   *
   * Never use layout entering animations for content that must be readable.
   */
  const enter = useSharedValue(0);

  useEffect(() => {
    if (status !== 'show') return;
    enter.value = reduced ? 1 : withTiming(1, { duration: Duration.enter });
  }, [status, reduced, enter]);

  const logoIn = useAnimatedStyle(() => ({ opacity: enter.value }));

  const copyIn = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 10 }],
  }));

  // The splash is still up, so rendering nothing here is invisible.
  if (status === 'checking') return null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={styles.body}>
        <Animated.View
          style={[
            styles.logo,
            logoIn,
            { backgroundColor: C.artwork },
            // A wide, soft bloom rather than a raised edge — this one object is
            // meant to look lit from within, not sitting on the page.
            { boxShadow: [{ offsetX: 0, offsetY: 26, blurRadius: 74, color: C.glow }] },
          ]}>
          <Text style={[styles.logoMark, { color: C.artInk }]}>aux</Text>
        </Animated.View>

        <Animated.View
          style={[styles.copy, copyIn]}>
          <Text style={[styles.headline, { color: C.ink }]}>
            {'Listen together,\nto the same second.'}
          </Text>
          <Text style={[styles.sub, { color: C.ink2 }]}>
            See what your people are playing right now, and drop into the room. Spotify or
            YouTube — everyone hears the same song at the same moment.
          </Text>
        </Animated.View>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={leave}
        style={({ pressed }) => [
          styles.cta,
          { backgroundColor: C.pill },
          dropped(C, 'lg'),
          pressed ? { opacity: 0.9 } : null,
        ]}>
        <Text style={[styles.ctaLabel, { color: C.pillInk }]}>Get started</Text>
      </Pressable>

      <Pressable accessibilityRole="button" onPress={leave} style={styles.secondary}>
        <Text style={[styles.secondaryLabel, { color: C.ink2 }]}>I already have an account</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 30,
    paddingBottom: Space.huge,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 38,
  },
  logo: {
    width: LOGO,
    height: LOGO,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoMark: {
    fontFamily: Fonts.extrabold,
    fontSize: 52,
    letterSpacing: tracking(52, -0.06),
  },
  copy: {
    alignItems: 'center',
  },
  headline: {
    ...Type.display(34),
    lineHeight: 37,
    letterSpacing: tracking(34, -0.035),
    textAlign: 'center',
  },
  sub: {
    ...Type.body(14.5),
    lineHeight: 22,
    marginTop: Space.lg,
    textAlign: 'center',
  },
  cta: {
    height: 56,
    borderRadius: Radii.button,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 15,
    letterSpacing: tracking(15, -0.005),
  },
  secondary: {
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  secondaryLabel: {
    fontFamily: Fonts.semibold,
    fontSize: 13.5,
  },
});
