/**
 * The first screen.
 *
 * The gradient wordmark, a tracked kicker, a short accent rule, one paragraph,
 * and the door. Nothing else.
 *
 * Built from design/nocturne/aux-nocturne.dc.html, screen "intro1" (L47-52).
 *
 * ONE SCREEN, NOT FOUR — a deliberate departure from the design, which restores
 * a four-page carousel (intro1 through intro4, with a progress rail and a Next
 * button). This app collapsed that to a single screen on purpose after the
 * feedback that it was "so descriptive in so many places", and four pages of
 * pitch before anyone can sign in is the most descriptive thing in the app.
 * The visual treatment here is entirely Nocturne's; only the page count is not.
 *
 * Shown ONCE. A flag in AsyncStorage forwards a returning user straight to
 * sign-in, which is why nothing here is load-bearing for understanding the app.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandRule, PrimaryCta, SecondaryLink } from '@/components/auth/onboarding';
import { Wordmark } from '@/components/shell/wordmark';
import { Duration, Fonts, Space, tracking, Type } from '@/lib/theme';
import { useColors } from '@/lib/theme-context';

const SEEN_KEY = 'aux:intro-seen';

/**
 * The screen gutter, and this screen used to say 30.
 *
 * Intro, Sign in, Claim handle and Profile setup are walked in sequence on a
 * first launch, and they were drawn at 30, 24, 22 and 18 — four content columns
 * in four taps, stepping inward at every one. 18 is the house value
 * (`src/components/ui/screen.tsx` and all eleven tab screens), so it is the one
 * the other three moved to.
 */
const GUTTER = 18;

/** The mark, at the design's Intro size. */
const LOGO = 62;
/** The brand rule under the kicker — 64 wide here, 52 on Sign in. */
const RULE_W = 64;

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

  /**
   * Mark the intro seen and go somewhere, and WHERE now matters.
   *
   * Both buttons on this screen used to call one handler that went to sign-in,
   * which was harmless while sign-in also carried a Create account tab. It is a
   * bug now that creating an account is its own route: this screen only ever
   * renders on a FIRST LAUNCH, so "Get started" was sending brand-new users to
   * a form for an account they do not have, and the door out of that — the
   * secondary link — went to exactly the same place.
   */
  const leave = useCallback((to: '/(auth)/create-account' | '/(auth)/sign-in') => {
    void AsyncStorage.setItem(SEEN_KEY, '1').catch(() => undefined);
    router.replace(to);
  }, []);

  /**
   * The entrance, driven by a shared value rather than a layout animation.
   *
   * `entering={FadeIn}` was the obvious way to write this and it is WRONG here:
   * Reanimated marks the view `visibility: hidden` until the entering animation
   * runs, and on react-native-web that animation never fired — leaving the
   * headline and the mark permanently invisible while reporting correct colour,
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

  const markIn = useAnimatedStyle(() => ({ opacity: enter.value }));

  const copyIn = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 10 }],
  }));

  // The splash is still up, so rendering nothing here is invisible.
  if (status === 'checking') return null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={styles.body}>
        {/*
          No tile behind the mark, deliberately.

          The previous version set it on a 172px `artwork` plate, which worked
          when `artwork` was a near-white tile. In this direction that token is a
          dark WELL and `artInk` is 22% white, so the same code renders a barely
          visible mark on a barely visible square. The design's answer is not a
          brighter plate: it is no plate, with the gradient carrying the mark.
        */}
        <Animated.View style={markIn}>
          <Wordmark size={LOGO} />
        </Animated.View>

        <Animated.View style={[styles.copy, copyIn]}>
          <Text style={[styles.kicker, { color: C.ink3 }]}>PASS THE AUX</Text>

          {/*
            Was an inline `LinearGradient` here and a second, near-identical one
            on Sign in, each declaring itself the only element in the app that
            paints both accents. Neither was — see `BrandRule`, which now owns
            the gradient, the height and the reasoning for all of it.
          */}
          <BrandRule width={RULE_W} style={styles.rule} />

          <Text style={[styles.sub, { color: C.ink2 }]}>
            You join a <Text style={{ color: C.ink, fontFamily: Fonts.semibold }}>Lounge</Text>, see
            who is listening to what right now, and tap in to hear the same chorus at the same
            moment.
          </Text>
        </Animated.View>
      </View>

      <PrimaryCta label="Get started" onPress={() => leave('/(auth)/create-account')} />
      <SecondaryLink
        label="I already have an account"
        onPress={() => leave('/(auth)/sign-in')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: GUTTER,
    paddingBottom: Space.huge,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    alignItems: 'center',
  },
  kicker: {
    fontFamily: Fonts.extrabold,
    fontSize: 9,
    letterSpacing: tracking(9, 0.26),
    marginTop: 22,
    // The design's own 0.85 on an already-quiet ink. It is the least important
    // thing on the screen and is set to say so.
    opacity: 0.85,
  },
  /** Spacing only — `BrandRule` carries the width, height and radius. */
  rule: {
    marginTop: 16,
  },
  sub: {
    ...Type.body(16),
    lineHeight: 26,
    marginTop: 20,
    textAlign: 'center',
    // 290 in the design. Caps the measure at roughly 45 characters so the
    // paragraph breaks into four even lines instead of one long ragged block.
    maxWidth: 290,
  },
});
